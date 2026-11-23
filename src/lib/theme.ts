/**
 * Visual themes for the whole app.
 *
 * The app is painted with `light-dark(var(--color-x), var(--color-x-dark))`,
 * so a theme is nothing more than both halves of every `--color-*` token. This
 * module owns three things and nothing else:
 *
 *   1. the palette: two seed colors (fondo, acento) expanded into every token
 *      in OKLCH, with lightness solved until the text actually reads;
 *   2. the theme state: preset + seeds + per-token overrides, both appearances;
 *   3. painting: writing the tokens onto <html> and remembering the choice.
 *
 * No CSS text box anywhere: a theme is a set of colors, not a stylesheet.
 */
import { useSyncExternalStore } from 'react'
import type { MessageKey } from '../i18n/index.ts'

export type Appearance = 'light' | 'dark'
/** Which half to paint: a fixed appearance, or whatever the OS is doing. */
export type AppearanceChoice = Appearance | 'system'

/** The five faces a person can choose. Sans ships as the default. */
export const TYPEFACES = ['sans', 'serif', 'oldstyle', 'hybrid', 'mono'] as const
export type TypefaceId = (typeof TYPEFACES)[number]

/**
 * The stacks themselves. System faces on purpose: zero bytes, no license, no
 * request. `reading` is what prose and chrome are set in; `heading` may differ,
 * which is the whole point of "hybrid" — serif titles over sans text.
 */
export const TYPEFACE_STACKS: Record<TypefaceId, { reading: string; heading?: string }> = {
  sans: { reading: 'var(--font-sans)' },
  serif: { reading: "Georgia, 'Times New Roman', serif" },
  oldstyle: {
    reading: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  hybrid: { reading: 'var(--font-sans)', heading: "Georgia, 'Times New Roman', serif" },
  mono: { reading: 'var(--font-mono)' },
}

/** Two independent choices: the prose you read and the app you click. */
export type TypefaceRole = 'note' | 'ui'
export type Typefaces = Record<TypefaceRole, TypefaceId>

const TYPEFACE_ROLES: readonly TypefaceRole[] = ['note', 'ui']

function isTypeface(value: unknown): value is TypefaceId {
  return typeof value === 'string' && (TYPEFACES as readonly string[]).includes(value)
}

/** Every color the stylesheet reads. Keep in sync with the tokens in index.css. */
export const THEME_TOKENS = [
  'bg',
  'bg2',
  'bg3',
  'page',
  'text',
  'muted',
  'border',
  'accent',
  'accentInk',
  'accentSolid',
  'danger',
  'success',
  'warning',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]
export type Palette = Record<ThemeToken, string>
/** The two colors a person picks. Everything else is derived from them. */
export type Seeds = { canvas: string; accent: string }
export type TokenOverrides = Partial<Record<ThemeToken, string>>

export interface ThemeState {
  /** The preset last chosen, kept so "Restablecer" has something to go back to. */
  presetId: string
  /** One design. It is written in one appearance; the other is mirrored. */
  seeds: Seeds
  overrides: TokenOverrides
  /** True once a seed or a token moved away from the preset. */
  edited: boolean
  /**
   * Which appearance to paint. `system` follows the OS, which was the only
   * option for a long time — and meant that on a dark machine a design written
   * light was never visible in its own colours, only as its mirror.
   */
  appearance: AppearanceChoice
  /** The note's face and the app's face, chosen separately. */
  typefaces: Typefaces
}

export interface ThemePreset {
  id: string
  /** Catalogue key, resolved with `t()` where the card is drawn. */
  nameKey: MessageKey
  /** The design itself: fondo + acento. The other appearance is mirrored. */
  seeds: Seeds
}

export const THEME_STORAGE_KEY = 'firemd-theme-v1'

/* ------------------------------------------------------------------ colors */

interface Rgb {
  r: number
  g: number
  b: number
}

interface Oklch {
  L: number
  C: number
  h: number
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Accepts #rgb and #rrggbb, and nothing else: no color names, no functions. */
function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim().toLowerCase()
  if (!HEX.test(input)) return null
  if (input.length === 4) {
    return `#${input[1]}${input[1]}${input[2]}${input[2]}${input[3]}${input[3]}`
  }
  return input
}

function hexToRgb(value: string): Rgb | null {
  const hex = normalizeHex(value)
  if (!hex) return null
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  }
}

function channelToHex(channel: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, channel)) * 255)
  return byte.toString(16).padStart(2, '0')
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

function rgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(a, bb)
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { L: clamp01(L), C, h: C < 1e-4 ? 0 : h }
}

function oklchToRgb(raw: Oklch): Rgb {
  // Chroma is reduced until the color fits sRGB, so a solved lightness never
  // lands outside the gamut and gets clipped into a different hue.
  let color = { L: clamp01(raw.L), C: Math.max(0, raw.C), h: raw.h }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const rgb = oklchToRgbUnclamped(color)
    if (rgb.r >= -0.0005 && rgb.r <= 1.0005 && rgb.g >= -0.0005 && rgb.g <= 1.0005 && rgb.b >= -0.0005 && rgb.b <= 1.0005) {
      return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b) }
    }
    color = { ...color, C: color.C * 0.94 }
    if (color.C < 1e-4) return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b) }
  }
  const rgb = oklchToRgbUnclamped(color)
  return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b) }
}

function oklchToRgbUnclamped({ L, C, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function toHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color))
}

export function relativeLuminance(value: string): number {
  const rgb = hexToRgb(value)
  if (!rgb) return 0
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/* --------------------------------------------------------------- derivation */

/**
 * Moves a color along lightness until it clears `minContrast` against every
 * background, keeping hue and chroma. It stops at the *closest* lightness that
 * passes, so a solved accent ink stays a tinted ink instead of collapsing to
 * black — which is what a naive "walk to the extreme" search produced.
 */
function readable(
  base: Oklch,
  backgrounds: readonly Oklch[],
  minContrast: number,
  direction: 'darker' | 'lighter',
): Oklch {
  const passes = (candidate: Oklch): boolean => {
    const hex = toHex(candidate)
    return backgrounds.every((background) => contrastRatio(hex, toHex(background)) >= minContrast)
  }
  if (passes(base)) return base

  const extreme = direction === 'darker' ? 0 : 1
  const fallback: Oklch = { ...base, L: extreme }
  if (!passes(fallback)) return fallback

  // `passing` holds a lightness known to pass, `failing` the base (known to
  // fail); the midpoint narrows in on the boundary closest to the base.
  let passing = extreme
  let failing = base.L
  let best = fallback
  for (let step = 0; step < 22; step += 1) {
    const middle = (passing + failing) / 2
    const candidate: Oklch = { ...base, L: middle }
    if (passes(candidate)) {
      best = candidate
      passing = middle
    } else {
      failing = middle
    }
  }
  return best
}

/** A surface step away from the canvas, tinted with the accent hue. */
function surface(canvas: Oklch, deltaL: number, chroma: number, hue: number): Oklch {
  return { L: clamp01(canvas.L + deltaL), C: chroma, h: hue }
}

const FALLBACK_CANVAS: Record<Appearance, string> = { light: '#ffffff', dark: '#1e1e1e' }
const FALLBACK_ACCENT = '#6f5ce0'

/** Status colors keep their hue and only borrow the theme's contrast. */
const STATUS: Record<'danger' | 'success' | 'warning', { h: number; C: number }> = {
  danger: { h: 27, C: 0.17 },
  success: { h: 150, C: 0.14 },
  warning: { h: 78, C: 0.14 },
}

/**
 * Which appearance a design was written in. A light fondo means the person is
 * designing on a light canvas; there is no separate dark design to maintain.
 */
export function designAppearance(seeds: Seeds): Appearance {
  const canvas = hexToRgb(seeds.canvas)
  if (!canvas) return 'light'
  return rgbToOklch(canvas).L >= 0.5 ? 'light' : 'dark'
}

/** The same design seen in the other appearance: same hue, mirrored lightness. */
export function mirrorSeeds(seeds: Seeds): Seeds {
  const canvas = hexToRgb(seeds.canvas) ?? hexToRgb(FALLBACK_CANVAS.light)!
  const color = rgbToOklch(canvas)
  const L = designAppearance(seeds) === 'light' ? 0.19 : 0.97
  return {
    canvas: toHex({ L, C: Math.min(color.C, 0.03), h: color.h }),
    accent: seeds.accent,
  }
}

/**
 * Expands the two colors a person picks into the full palette, for one
 * appearance. Everything downstream (text, muted text, accent ink, borders,
 * status colors) is solved against the surfaces it is actually painted on.
 */
export function derivePalette(seeds: Seeds, appearance: Appearance): Palette {
  const dark = appearance === 'dark'
  const canvasRgb = hexToRgb(seeds.canvas) ?? hexToRgb(FALLBACK_CANVAS[appearance])!
  const accentInput = hexToRgb(seeds.accent) ?? hexToRgb(FALLBACK_ACCENT)!
  const canvas = rgbToOklch(canvasRgb)
  const accent = rgbToOklch(accentInput)

  // A grey accent gives the surfaces no hue of their own: fall back to the
  // canvas hue so the result stays neutral instead of drifting to red.
  const hue = accent.C < 0.02 ? canvas.h : accent.h
  const tint = Math.min(0.04, Math.max(0.005, accent.C * 0.16))
  const lift = dark ? 1 : -1

  const bg = canvas
  const page = dark ? surface(canvas, -0.05, Math.min(tint, canvas.C + tint), hue) : canvas
  const bg2 = surface(canvas, lift * (dark ? 0.055 : 0.034), tint, hue)
  const bg3 = surface(canvas, lift * (dark ? 0.085 : 0.065), tint * 1.2, hue)
  const border = surface(canvas, lift * (dark ? 0.17 : 0.1), Math.min(0.05, accent.C * 0.3), hue)

  const textBase: Oklch = {
    L: dark ? 0.94 : 0.19,
    C: Math.min(0.018, accent.C * 0.12),
    h: hue,
  }
  const text = readable(textBase, [bg, page, bg2, bg3], 10.5, dark ? 'lighter' : 'darker')
  const muted = readable(
    { L: dark ? 0.74 : 0.46, C: Math.min(0.03, accent.C * 0.2), h: hue },
    [bg, bg2, bg3],
    5,
    dark ? 'lighter' : 'darker',
  )
  const accentInk = readable(
    { L: accent.L, C: Math.min(accent.C, 0.16), h: accent.h },
    [bg, bg2],
    4.6,
    dark ? 'lighter' : 'darker',
  )
  const accentSolid = readable(
    { L: Math.min(0.72, accent.L), C: Math.min(accent.C, 0.17), h: accent.h },
    [rgbToOklch({ r: 1, g: 1, b: 1 })],
    4.5,
    'darker',
  )
  const accentVisible = readable(
    { L: dark ? Math.min(0.86, accent.L + 0.1) : accent.L, C: accent.C, h: accent.h },
    [bg, page],
    2.1,
    dark ? 'lighter' : 'darker',
  )

  const status = (token: keyof typeof STATUS): string =>
    toHex(
      readable(
        { L: dark ? 0.78 : 0.55, C: STATUS[token].C, h: STATUS[token].h },
        [bg, bg2],
        4.8,
        dark ? 'lighter' : 'darker',
      ),
    )

  return {
    bg: toHex(bg),
    bg2: toHex(bg2),
    bg3: toHex(bg3),
    page: toHex(page),
    text: toHex(text),
    muted: toHex(muted),
    border: toHex(border),
    accent: toHex(accentVisible),
    accentInk: toHex(accentInk),
    accentSolid: toHex(accentSolid),
    danger: status('danger'),
    success: status('success'),
    warning: status('warning'),
  }
}

/* ------------------------------------------------------------------ presets */

const preset = (
  id: string,
  nameKey: MessageKey,
  seeds: Seeds
): ThemePreset => ({ id, nameKey, seeds })

/**
 * Twelve designs ready to use. Each one is fondo + acento; the eleven other
 * colors are derived, and the opposite appearance is mirrored from the same
 * design, so a preset is never "half a theme".
 */
export const PRESETS: readonly ThemePreset[] = [
  // Six designs written on a light canvas. The column is not six variations of
  // white: four of them sit between L 0.90 and 0.93, so the surface has body.
  preset('obsidiana', 'theme.obsidiana.name', {
    canvas: '#ffffff',
    accent: '#6f5ce0',
  }),
  preset('nordico', 'theme.nordico.name', {
    canvas: '#eef1f6',
    accent: '#4c6a92',
  }),
  preset('niebla', 'theme.niebla.name', {
    canvas: '#dde3ec',
    accent: '#4f6480',
  }),
  preset('lino', 'theme.lino.name', {
    canvas: '#e9e1d2',
    accent: '#7d6440',
  }),
  preset('salvia', 'theme.salvia.name', {
    canvas: '#dde7da',
    accent: '#457050',
  }),
  preset('miel', 'theme.miel.name', {
    canvas: '#f2e7c9',
    accent: '#8c6d24',
  }),
  // Six designs written dark, climbing off black. A mirror is always the same
  // L 0.19 canvas (see mirrorSeeds), so only a design authored dark gives the
  // dark appearance a background of its own.
  preset('consola', 'theme.consola.name', {
    canvas: '#080d09',
    accent: '#4ade80',
  }),
  preset('tinta', 'theme.tinta.name', {
    canvas: '#0f1420',
    accent: '#8fb3ff',
  }),
  preset('pizarra', 'theme.pizarra.name', {
    canvas: '#1c2027',
    accent: '#7fa0c9',
  }),
  preset('bruma', 'theme.bruma.name', {
    canvas: '#2a2f38',
    accent: '#a8bdd9',
  }),
  preset('oliva', 'theme.oliva.name', {
    canvas: '#2f342c',
    accent: '#b9c99a',
  }),
  preset('tabaco', 'theme.tabaco.name', {
    canvas: '#423b31',
    accent: '#dcbb8c',
  }),
]

/**
 * The theme a first visit paints. `nordico` is the calm blue-grey design: it is
 * the one the product ships as its own face, so a visitor's first frame is the
 * real editor in the real theme instead of a stock white page.
 */
export const DEFAULT_PRESET_ID = 'nordico'

export function findPreset(presetId: string): ThemePreset {
  return PRESETS.find((entry) => entry.id === presetId) ?? PRESETS[0]
}

/* -------------------------------------------------------------------- state */

export function presetState(presetId: string): ThemeState {
  const chosen = findPreset(presetId)
  return {
    presetId: chosen.id,
    seeds: { ...chosen.seeds },
    overrides: {},
    edited: false,
    appearance: 'system',
    typefaces: { note: 'sans', ui: 'sans' },
  }
}

const DEFAULT_THEME_STATE: ThemeState = presetState(DEFAULT_PRESET_ID)

/**
 * The palette actually painted. Both appearances come from the one design: the
 * appearance it was written in is used as is, the other is mirrored.
 */
export function setTypeface(
  state: ThemeState,
  role: TypefaceRole,
  typeface: TypefaceId,
): ThemeState {
  if (!TYPEFACE_ROLES.includes(role) || !isTypeface(typeface)) return state
  if (state.typefaces[role] === typeface) return state
  return { ...state, typefaces: { ...state.typefaces, [role]: typeface } }
}

export function resolvePalette(state: ThemeState, appearance: Appearance): Palette {
  const written = designAppearance(state.seeds)
  const base =
    appearance === written
      ? derivePalette(state.seeds, appearance)
      : derivePalette(mirrorSeeds(state.seeds), appearance)

  // Overrides land on the palette that is painted, whichever half that is: with
  // one palette on screen at a time, a tweak made while looking at the mirrored
  // half would otherwise be written nowhere the person can see.
  const merged = { ...base }
  for (const token of THEME_TOKENS) {
    const value = normalizeHex(state.overrides[token])
    if (value) merged[token] = value
  }
  return merged
}

export function updateSeed(state: ThemeState, seeds: Seeds): ThemeState {
  const canvas = normalizeHex(seeds.canvas)
  const accent = normalizeHex(seeds.accent)
  if (!canvas || !accent) return state
  return { ...state, seeds: { canvas, accent }, edited: true }
}

export function setTokenOverride(state: ThemeState, token: ThemeToken, value: string | null): ThemeState {
  const next: TokenOverrides = { ...state.overrides }
  const hex = normalizeHex(value)
  if (hex) next[token] = hex
  else delete next[token]
  return { ...state, overrides: next, edited: true }
}

export function clearOverrides(state: ThemeState): ThemeState {
  return { ...state, overrides: {}, edited: state.edited }
}

/** Back to the preset exactly as shipped, keeping the chosen appearance. */
export function resetToPreset(state: ThemeState): ThemeState {
  return { ...presetState(state.presetId), appearance: state.appearance }
}

/**
 * Picks a design and paints it in the appearance it was written in. The preset
 * grid is two columns, light on the left and dark on the right, so the column
 * the person picks *is* the appearance choice.
 */
export function selectPreset(_state: ThemeState, presetId: string): ThemeState {
  const chosen = presetState(presetId)
  return { ...chosen, appearance: designAppearance(chosen.seeds) }
}

/* ----------------------------------------------------------------- painting */

const CSS_NAMES: Record<ThemeToken, string> = {
  bg: 'bg',
  bg2: 'bg-2',
  bg3: 'bg-3',
  page: 'page',
  text: 'text',
  muted: 'muted',
  border: 'border',
  accent: 'accent',
  accentInk: 'accent-ink',
  accentSolid: 'accent-solid',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
}

/** Both halves of every token, as CSS custom properties. */
/**
 * The appearance actually on screen: the chosen one, or the OS when the person
 * left it on `system`.
 */
export function paintedAppearance(state: ThemeState): Appearance {
  if (state.appearance !== 'system') return state.appearance
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function themeCssVars(state: ThemeState): Record<string, string> {
  const palette = resolvePalette(state, paintedAppearance(state))
  const vars: Record<string, string> = {}
  for (const token of THEME_TOKENS) {
    const name = `--color-${CSS_NAMES[token]}`
    // Both halves carry the same colour. One palette is on screen at a time, so
    // a theme change is a single colour change — and a single colour change is
    // something the browser can interpolate. With two different halves,
    // `light-dark()` would switch discretely and the change would jump.
    vars[name] = palette[token]
    vars[`${name}-dark`] = palette[token]
  }
  return vars
}

/** How long the palette takes to travel between designs, in ms. */
const THEME_FADE_MS = 220

const fadeTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/**
 * Switches the palette transition on for one design change, then off again.
 * The attribute is what `html[data-theme-fade]` in index.css keys off; leaving
 * it on would make every later colour edit lag behind its own picker.
 */
function startFade(target: HTMLElement): void {
  target.dataset.themeFade = 'true'
  const pending = fadeTimers.get(target)
  if (pending !== undefined) clearTimeout(pending)
  fadeTimers.set(
    target,
    setTimeout(() => {
      delete target.dataset.themeFade
      fadeTimers.delete(target)
    }, THEME_FADE_MS),
  )
}

export function applyTheme(state: ThemeState, root?: HTMLElement | null): void {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement)
  if (!target?.style) return

  const painted = paintedAppearance(state)

  // Remembered on the element, not in module state, so a fresh <html> (a test,
  // a second document) cannot inherit a stale idea of what is painted.
  const previousKey = target.dataset.themeKey
  const key = `${state.presetId}|${painted}`
  target.dataset.themeKey = key
  if (previousKey !== undefined && previousKey !== key) startFade(target)

  for (const [name, value] of Object.entries(themeCssVars(state))) {
    target.style.setProperty(name, value)
  }
  // One appearance, so native widgets (scrollbars, form controls, the caret)
  // agree with the palette instead of following the OS on their own.
  target.style.setProperty('color-scheme', painted)
  // Fonts ride along in the same pass. Two roles, four tokens: index.css reads
  // `--font-reading`/`--font-heading` for the note and `--font-ui`/
  // `--font-ui-heading` for everything around it.
  const note = TYPEFACE_STACKS[state.typefaces.note] ?? TYPEFACE_STACKS.sans
  const ui = TYPEFACE_STACKS[state.typefaces.ui] ?? TYPEFACE_STACKS.sans
  target.style.setProperty('--font-reading', note.reading)
  target.style.setProperty('--font-heading', note.heading ?? note.reading)
  target.style.setProperty('--font-ui', ui.reading)
  target.style.setProperty('--font-ui-heading', ui.heading ?? ui.reading)
}

/* -------------------------------------------------------- storage & React API */

function readStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function parseSeeds(value: unknown, fallback: Seeds): Seeds {
  if (!value || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  return {
    canvas: normalizeHex(record.canvas) ?? fallback.canvas,
    accent: normalizeHex(record.accent) ?? fallback.accent,
  }
}

function parseOverrides(value: unknown): TokenOverrides {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const parsed: TokenOverrides = {}
  for (const token of THEME_TOKENS) {
    const hex = normalizeHex(record[token])
    if (hex) parsed[token] = hex
  }
  return parsed
}

function parseTypefaces(value: unknown, legacy: unknown): Typefaces {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  // `typeface` was a single choice before it split into two roles; honour it.
  const fallback = isTypeface(legacy) ? legacy : 'sans'
  return {
    note: isTypeface(record.note) ? record.note : fallback,
    ui: isTypeface(record.ui) ? record.ui : fallback,
  }
}

function parseAppearance(value: unknown): AppearanceChoice {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function parseThemeState(raw: string | null): ThemeState {
  if (!raw) return DEFAULT_THEME_STATE
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_THEME_STATE
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_THEME_STATE
  const record = parsed as Record<string, unknown>
  const presetId = typeof record.presetId === 'string' ? record.presetId : DEFAULT_PRESET_ID
  if (!PRESETS.some((entry) => entry.id === presetId)) return DEFAULT_THEME_STATE

  const base = presetState(presetId)
  return {
    presetId,
    seeds: parseSeeds(record.seeds, base.seeds),
    overrides: parseOverrides(record.overrides),
    edited: record.edited === true,
    appearance: parseAppearance(record.appearance),
    typefaces: parseTypefaces(record.typefaces, record.typeface),
  }
}

export function loadThemeState(): ThemeState {
  const storage = readStorage()
  if (!storage) return DEFAULT_THEME_STATE
  try {
    return parseThemeState(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_STATE
  }
}

export function saveThemeState(state: ThemeState): void {
  const storage = readStorage()
  if (!storage) return
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A full or blocked storage only costs the preference, never the app.
  }
}

let current: ThemeState | null = null
const listeners = new Set<() => void>()

function getThemeState(): ThemeState {
  current ??= loadThemeState()
  return current
}

export function setThemeState(next: ThemeState): void {
  current = next
  saveThemeState(next)
  applyTheme(next)
  for (const listener of [...listeners]) listener()
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reactive view of the theme for components. */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, getThemeState)
}

/** Paints the stored theme before the first render, so nothing flashes. */
let watchingSystemAppearance = false

/**
 * While the choice is `system`, the OS decides which palette is painted — so a
 * change there has to repaint. It goes through applyTheme like any other theme
 * change, which means it fades too.
 */
function watchSystemAppearance(): void {
  if (watchingSystemAppearance) return
  if (typeof window === 'undefined' || !window.matchMedia) return
  watchingSystemAppearance = true
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const state = getThemeState()
    if (state.appearance === 'system') applyTheme(state)
  })
}

export function startTheme(): ThemeState {
  const state = getThemeState()
  applyTheme(state)
  watchSystemAppearance()
  return state
}
