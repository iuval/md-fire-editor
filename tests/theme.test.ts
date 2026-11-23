// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { t } from '../src/i18n/index.ts'
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
  applyTheme,
  contrastRatio,
  designAppearance,
  derivePalette,
  loadThemeState,
  mirrorSeeds,
  paintedAppearance,
  parseThemeState,
  presetState,
  relativeLuminance,
  selectPreset,
  resolvePalette,
  saveThemeState,
  setTokenOverride,
  themeCssVars,
  updateSeed,
  clearOverrides,
  type Appearance,
  type Seeds,
  type ThemeState,
} from '../src/lib/theme'

const APPEARANCES: Appearance[] = ['light', 'dark']

/** The state a person gets when they pin an appearance by hand. */
function pinned(presetId: string, appearance: Appearance): ThemeState {
  return { ...presetState(presetId), appearance }
}
const HEX = /^#[0-9a-f]{6}$/

beforeEach(() => {
  localStorage.clear()
})

describe('presets', () => {
  it('ships at least ten ready-to-use themes with unique ids', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length)
    expect(PRESETS.some((preset) => preset.id === DEFAULT_PRESET_ID)).toBe(true)
  })

  it('is one design per preset: a fondo and an acento', () => {
    for (const preset of PRESETS) {
      expect(t(preset.nameKey).length).toBeGreaterThan(0)
      expect(preset.seeds.canvas, preset.id).toMatch(HEX)
      expect(preset.seeds.accent, preset.id).toMatch(HEX)
      expect(Object.keys(preset.seeds).sort()).toEqual(['accent', 'canvas'])
    }
  })

  it('spans lightness instead of only hue', () => {
    // The catalogue used to be two clusters: near-white and near-black, with
    // nothing in between. A preset only feels different if its canvas sits at
    // a different lightness, so the catalogue has to cover the middle band and
    // include designs written dark (a mirror is always the same near-black).
    const designs = PRESETS.map((preset) => ({
      id: preset.id,
      luminance: relativeLuminance(
        resolvePalette(presetState(preset.id), designAppearance(preset.seeds)).bg,
      ),
    }))
    // The grid is two columns of equal length: the light designs on the left,
    // the dark ones on the right. An unbalanced catalogue makes one column
    // dangle, so the count is a contract.
    const light = designs.filter((design) => design.luminance > 0.5)
    const dark = designs.filter((design) => design.luminance <= 0.5)
    expect(light.length, 'light column').toBe(6)
    expect(dark.length, 'dark column').toBe(6)

    // The light column is not six variations of white: at least four designs
    // sit below luminance 0.86, so the surface actually has body.
    expect(light.filter((design) => design.luminance < 0.86).length, 'light with body').toBeGreaterThanOrEqual(4)

    // "Dark" is not enough either: a dim design — lifted off black, still
    // readable at night — lives between 0.02 and 0.09, and half the dark column
    // used to be black instead.
    const dim = dark.filter((design) => design.luminance > 0.02 && design.luminance < 0.09)
    expect(dim.map((design) => design.id), 'dim, lifted off black').toHaveLength(3)
  })
})

describe('one design, two appearances', () => {
  it('reads the design appearance from the fondo', () => {
    expect(designAppearance({ canvas: '#ffffff', accent: '#6f5ce0' })).toBe('light')
    expect(designAppearance({ canvas: '#080d09', accent: '#4ade80' })).toBe('dark')
  })

  it('mirrors the design instead of asking for a second one', () => {
    const light = mirrorSeeds({ canvas: '#ffffff', accent: '#6f5ce0' })
    expect(light.accent).toBe('#6f5ce0')
    expect(relativeLuminance(light.canvas)).toBeLessThan(0.1)

    const dark = mirrorSeeds({ canvas: '#080d09', accent: '#4ade80' })
    expect(relativeLuminance(dark.canvas)).toBeGreaterThan(0.85)
  })

  it('paints the design as written and the mirror on the other side', () => {
    const state = presetState('consola')
    const design = resolvePalette(state, 'dark')
    expect(design.bg).toBe('#080d09')
    const mirrored = resolvePalette(state, 'light')
    expect(mirrored.bg).not.toBe('#080d09')
    expect(relativeLuminance(mirrored.bg)).toBeGreaterThan(0.8)
  })
})

describe('palette derivation', () => {
  const palettes = PRESETS.flatMap((preset) =>
    APPEARANCES.map((appearance) => ({
      id: `${preset.id}/${appearance}`,
      palette: resolvePalette(presetState(preset.id), appearance),
    })),
  )

  it('paints every token as a plain hex color', () => {
    for (const { id, palette } of palettes) {
      for (const token of THEME_TOKENS) expect(palette[token], `${id} ${token}`).toMatch(HEX)
    }
  })

  it('keeps body text readable on every preset, in both appearances', () => {
    for (const { id, palette } of palettes) {
      expect(contrastRatio(palette.text, palette.bg), `${id} text on bg`).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(palette.text, palette.page), `${id} text on page`).toBeGreaterThanOrEqual(7)
    }
  })

  it('keeps muted text readable on the tinted surfaces it sits on', () => {
    for (const { id, palette } of palettes) {
      for (const surface of [palette.bg, palette.bg2, palette.bg3] as const) {
        expect(contrastRatio(palette.muted, surface), `${id} muted on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps accent text and filled accent buttons legible', () => {
    for (const { id, palette } of palettes) {
      expect(contrastRatio(palette.accentInk, palette.bg2), `${id} accent ink`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.accentSolid, '#ffffff'), `${id} accent solid`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps a solved color tinted instead of collapsing it to black or white', () => {
    for (const { id, palette } of palettes) {
      expect(palette.accentInk, id).not.toBe('#000000')
      expect(palette.accentInk, id).not.toBe('#ffffff')
      expect(palette.text, id).not.toBe('#ffffff')
      for (const token of ['danger', 'success', 'warning'] as const) {
        expect(palette[token], `${id} ${token}`).not.toBe('#000000')
      }
    }
  })

  it('keeps the semantic colors readable', () => {
    for (const { id, palette } of palettes) {
      for (const token of ['danger', 'success', 'warning'] as const) {
        expect(contrastRatio(palette[token], palette.bg), `${id} ${token}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('steps surfaces away from the page and keeps borders visible', () => {
    for (const { id, palette } of palettes) {
      expect(palette.bg2, id).not.toBe(palette.bg)
      expect(palette.bg3, id).not.toBe(palette.bg2)
      expect(contrastRatio(palette.border, palette.bg), id).toBeGreaterThan(1.15)
    }
  })

  it('derives a darker page than the bars in dark mode', () => {
    const palette = resolvePalette(presetState(DEFAULT_PRESET_ID), 'dark')
    expect(relativeLuminance(palette.page)).toBeLessThan(relativeLuminance(palette.bg))
  })

  it('falls back to a sane palette when the seeds are not colors', () => {
    const palette = derivePalette({ canvas: 'nope', accent: '#zzz' }, 'light')
    for (const token of THEME_TOKENS) expect(palette[token]).toMatch(HEX)
    expect(contrastRatio(palette.text, palette.bg)).toBeGreaterThanOrEqual(7)
  })
})

describe('theme state', () => {
  it('starts on the default preset when storage is empty', () => {
    const state = loadThemeState()
    expect(state.presetId).toBe(DEFAULT_PRESET_ID)
    expect(state.seeds).toEqual(presetState(DEFAULT_PRESET_ID).seeds)
    expect(state.overrides).toEqual({})
  })

  it('round-trips through storage', () => {
    const state = presetState(PRESETS[3].id)
    saveThemeState(state)
    expect(loadThemeState()).toEqual(state)
  })

  it('ignores corrupt storage instead of painting a broken palette', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{not json')
    expect(loadThemeState().presetId).toBe(DEFAULT_PRESET_ID)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ presetId: 'gone', seeds: 'x' }))
    expect(loadThemeState().presetId).toBe(DEFAULT_PRESET_ID)
  })

  it('merges per-token overrides over the derived palette', () => {
    const base = presetState(PRESETS[0].id)
    const state = setTokenOverride(base, 'bg2', '#123456')
    expect(resolvePalette(state, 'light').bg2).toBe('#123456')
    expect(resolvePalette(state, 'light').bg).toBe(resolvePalette(base, 'light').bg)
    expect(resolvePalette(clearOverrides(state), 'light').bg2).toBe(resolvePalette(base, 'light').bg2)
  })

  it('marks the theme as customized once a seed changes', () => {
    const base = presetState(PRESETS[1].id)
    const seeds: Seeds = { ...base.seeds, accent: '#00aa00' }
    const state = updateSeed(base, seeds)
    expect(state.presetId).toBe(PRESETS[1].id)
    expect(state.edited).toBe(true)
    expect(resolvePalette(state, 'light').accent).not.toBe(resolvePalette(base, 'light').accent)
  })

  it('ignores a seed that is not a color', () => {
    const base = presetState(PRESETS[1].id)
    expect(updateSeed(base, { canvas: 'crema', accent: '#00aa00' })).toBe(base)
  })
})

function cssPainted(root: HTMLElement, name: string): string {
  return root.style.getPropertyValue(name)
}

describe('applying a theme', () => {
  it('paints one palette into both halves, so a theme change is one colour change', () => {
    // Two different halves would make `light-dark()` switch discretely, and a
    // discrete switch cannot be interpolated — that is exactly why switching
    // appearance used to jump instead of fade.
    const state = presetState(PRESETS[2].id)
    const vars = themeCssVars(state)
    const painted = resolvePalette(state, paintedAppearance(state))
    for (const token of THEME_TOKENS) {
      const name = `--color-${CSS_TOKEN_NAMES[token]}`
      expect(vars[name], token).toBe(painted[token])
      expect(vars[`${name}-dark`], token).toBe(painted[token])
      expect(vars[name], token).toMatch(HEX)
    }
  })

  it('lets the person pick the appearance, with the OS as the default', () => {
    // Following the OS was the only switch the app had, so on a dark machine a
    // design written light was never visible in its own colours: it was always
    // painted as its mirror. Choosing has to be possible, and it has to win.
    const root = document.documentElement
    const base = presetState(PRESETS[4].id)
    expect(base.appearance).toBe('system')

    applyTheme(base, root)
    // jsdom has no matchMedia, so `system` resolves to light here; the point is
    // that it resolves to one scheme, never to "light dark".
    expect(root.style.getPropertyValue('color-scheme')).toBe('light')

    applyTheme(pinned(base.presetId, 'light'), root)
    expect(root.style.getPropertyValue('color-scheme')).toBe('light')

    applyTheme(pinned(base.presetId, 'dark'), root)
    expect(root.style.getPropertyValue('color-scheme')).toBe('dark')

    expect(root.style.getPropertyValue('--color-bg')).toMatch(HEX)
    expect(root.style.getPropertyValue('--color-bg-dark')).toMatch(HEX)
  })

  it('fades a design change and never a colour edit', () => {
    const root = document.documentElement
    root.removeAttribute('data-theme-key')
    root.removeAttribute('data-theme-fade')

    // First paint: there is nothing to travel from.
    applyTheme(presetState('nordico'), root)
    expect(root.getAttribute('data-theme-fade')).toBeNull()

    // A design change is a jump the eye should follow.
    applyTheme(selectPreset(presetState('nordico'), 'lino'), root)
    expect(root.getAttribute('data-theme-fade')).toBe('true')

    // Dragging a picker is not: the value under the cursor would trail the
    // value on screen.
    root.removeAttribute('data-theme-fade')
    const edited = updateSeed(presetState('lino'), { canvas: '#e9e1d2', accent: '#123456' })
    applyTheme(edited, root)
    expect(root.getAttribute('data-theme-fade')).toBeNull()

    // Crossing from a light design to a dark one is the case that used to jump:
    // the palette is one thing now, so it travels like any other change.
    root.removeAttribute('data-theme-fade')
    applyTheme(selectPreset(presetState('lino'), 'tabaco'), root)
    expect(root.getAttribute('data-theme-fade'), 'light -> dark fades').toBe('true')
    expect(cssPainted(root, '--color-bg')).toBe(resolvePalette(presetState('tabaco'), 'dark').bg)
  })

  it('remembers the chosen appearance and ignores a value it never wrote', () => {
    const base = presetState('nordico')
    const forced = pinned(base.presetId, 'light')
    expect(parseThemeState(JSON.stringify(forced)).appearance).toBe('light')
    expect(parseThemeState(JSON.stringify({ ...forced, appearance: 'purple' })).appearance).toBe(
      'system',
    )
  })

  it('paints a chosen design in the appearance it was written in', () => {
    // The preset grid is two columns, light on the left and dark on the right,
    // and there is no appearance switch: the column you pick is the choice. So
    // choosing has to move the appearance to match the design.
    const onDark = pinned('nordico', 'dark')
    expect(selectPreset(onDark, 'niebla').appearance).toBe('light')
    expect(selectPreset(onDark, 'tabaco').appearance).toBe('dark')
  })
})

/** The token → CSS names index.css reads. Duplicated on purpose: it is a contract. */
const CSS_TOKEN_NAMES: Record<string, string> = {
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
