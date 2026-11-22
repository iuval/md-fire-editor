// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
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
  presetState,
  relativeLuminance,
  resolvePalette,
  saveThemeState,
  setTokenOverride,
  themeCssVars,
  updateSeed,
  clearOverrides,
  type Appearance,
  type Seeds,
} from '../src/lib/theme'

const APPEARANCES: Appearance[] = ['light', 'dark']
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
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.seeds.canvas, preset.id).toMatch(HEX)
      expect(preset.seeds.accent, preset.id).toMatch(HEX)
      expect(Object.keys(preset.seeds).sort()).toEqual(['accent', 'canvas'])
    }
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

describe('applying a theme', () => {
  it('writes both halves of every token so light-dark() resolves', () => {
    const vars = themeCssVars(presetState(PRESETS[2].id))
    expect(vars['--color-bg']).toMatch(HEX)
    expect(vars['--color-bg-dark']).toMatch(HEX)
    expect(vars['--color-bg-2']).toMatch(HEX)
    expect(vars['--color-bg-3-dark']).toMatch(HEX)
    expect(vars['--color-accent-ink-dark']).toMatch(HEX)
    expect(vars['--color-accent-solid']).toMatch(HEX)
    expect(vars['--color-page-dark']).toMatch(HEX)
    expect(vars['--color-warning']).toMatch(HEX)
    for (const token of THEME_TOKENS) {
      expect(vars[`--color-${CSS_TOKEN_NAMES[token]}`], token).toMatch(HEX)
      expect(vars[`--color-${CSS_TOKEN_NAMES[token]}-dark`], token).toMatch(HEX)
    }
  })

  it('paints the document and always lets the OS choose the appearance', () => {
    const root = document.documentElement
    applyTheme(presetState(PRESETS[4].id), root)
    expect(root.style.getPropertyValue('color-scheme')).toBe('light dark')
    expect(root.style.getPropertyValue('--color-bg')).toMatch(HEX)
    expect(root.style.getPropertyValue('--color-bg-dark')).toMatch(HEX)
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
