// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeDialog } from '../src/components/ThemeDialog'
import { t } from '../src/i18n/index.ts'
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  THEME_TOKENS,
  derivePalette,
  findPreset,
  loadThemeState,
  presetState,
  resolvePalette,
  setThemeState,
} from '../src/lib/theme'

let roots: Root[] = []
let host: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

function cards(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.theme-card')]
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

beforeEach(() => {
  localStorage.clear()
  // The theme store is module state, so each test starts from a fresh boot
  // instead of inheriting the theme the previous one chose.
  setThemeState(loadThemeState())
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

describe('theme dialog', () => {
  it('shows one card per ready-made theme, each with its two colors', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    expect(PRESETS.length).toBeGreaterThanOrEqual(10)
    expect(cards()).toHaveLength(PRESETS.length)
    for (const card of cards()) {
      const squares = card.querySelectorAll<HTMLElement>('.theme-card-square')
      expect(squares).toHaveLength(2)
      expect(squares[0].style.background).not.toBe('')
      expect(squares[1].style.background).not.toBe('')
      expect(card.querySelector('.theme-card-name')?.textContent).toBeTruthy()
    }
  })

  it('paints a theme the moment its card is chosen', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const target = PRESETS[5]
    const before = cssVar('--color-bg')
    act(() => cards()[5].click())

    const expected = resolvePalette(presetState(target.id), 'light')
    expect(cssVar('--color-bg')).toBe(expected.bg)
    expect(cssVar('--color-bg')).not.toBe(before)
    expect(cssVar('--color-accent')).toBe(expected.accent)
    expect(cards()[5].getAttribute('aria-pressed')).toBe('true')
  })

  it('shows every color at once, with no appearance switch to babysit', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    // Fondo and Acento are the seeds; every other token has its own field, and
    // all of them are visible at once — nothing hides behind a disclosure.
    expect(document.querySelectorAll('.color-field')).toHaveLength(THEME_TOKENS.length)
    const labels = [...document.querySelectorAll('input[type="color"]')].map((input) =>
      input.getAttribute('aria-label'),
    )
    for (const label of ['Background', 'Accent', 'Text', 'Borders', 'Errors', 'Confirmations']) {
      expect(labels).toContain(label)
    }
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Claro')).toBe(false)
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Oscuro')).toBe(false)
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Sistema')).toBe(false)
  })

  it('re-derives the palette when the fondo swatch is picked', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const fondo = document.querySelector<HTMLInputElement>('input[aria-label="Background"]')
    expect(fondo).not.toBeNull()

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(fondo, '#fdf6e3')
      fondo!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const expected = derivePalette(
      { canvas: '#fdf6e3', accent: findPreset(DEFAULT_PRESET_ID).seeds.accent },
      'light',
    )
    expect(cssVar('--color-bg')).toBe(expected.bg)
    expect(cssVar('--color-bg-dark')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('edits the design even when the screen is in the other appearance', () => {
    // jsdom reports no dark support, so force the OS into dark for this test.
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    })
    try {
      mount(<ThemeDialog onClose={() => {}} />)
      // Every preset is written in one appearance; on a dark screen the fields
      // still show the light half, so a tweak is never painted nowhere.
      const paneles = document.querySelector<HTMLInputElement>('input[aria-label="Panels"]')
      expect(paneles?.value).toBe(resolvePalette(presetState(DEFAULT_PRESET_ID), 'light').bg2)

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      act(() => {
        setter?.call(paneles, '#123456')
        paneles!.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(cssVar('--color-bg-2')).toBe('#123456')
      // The mirrored half stays derived from the design instead of copying the tweak.
      expect(cssVar('--color-bg-2-dark')).not.toBe('#123456')
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: original,
      })
    }
  })

  it('restores the preset after the colors were touched', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const preset = findPreset(DEFAULT_PRESET_ID)
    const original = resolvePalette(presetState(preset.id), 'light').bg

    const swatch = document.querySelector<HTMLButtonElement>('.color-swatch[aria-label="Background: #1e1e1e"]')
    expect(swatch).not.toBeNull()
    act(() => swatch!.click())
    expect(cssVar('--color-bg')).not.toBe(original)

    act(() => buttonByText(t('themeDialog.reset', { name: t(preset.nameKey) })).click())
    expect(cssVar('--color-bg')).toBe(original)
  })

  it('drops the per-color tweaks when asked', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const original = resolvePalette(presetState(DEFAULT_PRESET_ID), 'light').bg2
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Panels"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(field, '#123456')
      field!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cssVar('--color-bg-2')).toBe('#123456')

    act(() => buttonByText('Quitar mis ajustes de color').click())
    expect(cssVar('--color-bg-2')).toBe(original)
  })

  it('reports the chosen theme inside a normal dialog shell', () => {
    const onClose = vi.fn()
    mount(<ThemeDialog onClose={onClose} />)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.getElementById('theme-heading')?.textContent).toContain('Appearance')
    expect(document.querySelector('.theme-thumb')).not.toBeNull()
    act(() => buttonByText('Done').click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
