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
  designAppearance,
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

function tabByRole(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (tab) => (tab.textContent ?? '').trim() === label,
  )
  if (!found) throw new Error(`no tab "${label}"`)
  return found
}

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
      // A card is the two colours and the name, nothing else.
      expect(card.querySelector('.theme-card-hint')).toBeNull()
    }
  })

  it('offers no appearance switch: the two columns are the choice', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    expect(document.querySelector('.theme-appearance')).toBeNull()
    for (const label of ['System', 'Day', 'Night']) {
      expect(() => buttonByText(label), label).toThrow()
    }
    const columns = [...document.querySelectorAll<HTMLElement>('.theme-column')]
    expect(columns).toHaveLength(2)
    for (const [index, appearance] of (['light', 'dark'] as const).entries()) {
      const inColumn = [...columns[index].querySelectorAll('.theme-card-name')].map(
        (name) => name.textContent,
      )
      const expected = PRESETS.filter((preset) => designAppearance(preset.seeds) === appearance).map(
        (preset) => t(preset.nameKey),
      )
      expect(inColumn).toEqual(expected)
    }
  })

  it('builds a combination from the squares of two different cards', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const obsidian = presetState('obsidiana')
    const honeyCanvas = '#f2e7c9' // Honey's background
    const tobaccoAccent = '#dcbb8c' // Tobacco's accent

    // Baseline: the whole Obsidian design.
    act(() => cards()[0].querySelector<HTMLButtonElement>('.theme-card-select')!.click())

    // A background on its own: the surface moves, and the ink is solved against
    // it, but it is still Obsidian's ink.
    act(() => cards()[5].querySelector<HTMLButtonElement>('.theme-card-square--canvas')!.click())
    const withHoney = resolvePalette(
      { ...obsidian, seeds: { ...obsidian.seeds, canvas: honeyCanvas } },
      'light',
    )
    expect(cssVar('--color-bg')).toBe(withHoney.bg)
    expect(cssVar('--color-accent')).toBe(withHoney.accent)
    expect(cards()[5].querySelector('.theme-card-square--canvas')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(cards()[0].querySelector('.theme-card-square--canvas')?.getAttribute('aria-pressed')).toBe(
      'false',
    )

    // An accent from a different card: now the two halves come from two designs.
    act(() => cards()[11].querySelector<HTMLButtonElement>('.theme-card-square--accent')!.click())
    const mixed = resolvePalette(
      { ...obsidian, seeds: { canvas: honeyCanvas, accent: tobaccoAccent } },
      'light',
    )
    expect(cssVar('--color-bg')).toBe(mixed.bg)
    expect(cssVar('--color-accent')).toBe(mixed.accent)
    expect(cards()[11].querySelector('.theme-card-square--accent')?.getAttribute('aria-pressed')).toBe(
      'true',
    )

    // The name still takes a whole design in one click.
    act(() => cards()[1].querySelector<HTMLButtonElement>('.theme-card-select')!.click())
    const nordic = resolvePalette(presetState(PRESETS[1].id), 'light')
    expect(cssVar('--color-bg')).toBe(nordic.bg)
    expect(cssVar('--color-accent')).toBe(nordic.accent)
  })

  it('paints a theme the moment its card is chosen', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const target = PRESETS[5]
    const before = cssVar('--color-bg')
    act(() => cards()[5].querySelector<HTMLButtonElement>('.theme-card-select')!.click())

    const expected = resolvePalette(presetState(target.id), 'light')
    expect(cssVar('--color-bg')).toBe(expected.bg)
    expect(cssVar('--color-bg')).not.toBe(before)
    expect(cssVar('--color-accent')).toBe(expected.accent)
    expect(cards()[5].querySelector('.theme-card-select')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
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

  it('lands a colour tweak on the palette that is on screen', () => {
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
      // Both halves carry the same palette now, so the tweak shows in both. One
      // palette on screen is what makes an appearance change interpolable.
      expect(cssVar('--color-bg-2-dark')).toBe('#123456')
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: original,
      })
    }
  })

  it('keeps the title and Done pinned in a bar that never scrolls away', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const bar = document.querySelector('.theme-bar')
    expect(bar, 'title bar').not.toBeNull()
    expect(bar?.querySelector('#theme-heading'), 'title inside the bar').not.toBeNull()
    // Done has to travel with the bar, so it is reachable without scrolling.
    expect(bar?.contains(buttonByText(t('themeDialog.done')))).toBe(true)
  })

  it('splits the panel into a Colors tab and a Typeface tab', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Colors', 'Typeface'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    // Colors is the tab that opens: the themes are there, the faces are not.
    expect(document.querySelector('.theme-grid')).not.toBeNull()
    expect(document.querySelector('.theme-typefaces')).toBeNull()

    act(() => tabs[1].click())
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(document.querySelector('.theme-grid')).toBeNull()
    expect(document.querySelector('.theme-typefaces')).not.toBeNull()

    // The two panels are wired to their tabs, not just swapped in place.
    const panel = document.querySelector('[role="tabpanel"]')
    expect(panel?.getAttribute('aria-labelledby')).toBe('theme-tab-typeface')
  })

  it('offers five faces per role, in two columns', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    act(() => tabByRole('Typeface').click())

    const columns = [...document.querySelectorAll<HTMLElement>('.theme-typeface-col')]
    expect(columns).toHaveLength(2)
    expect(columns.map((c) => c.querySelector('.theme-typeface-col-title')?.textContent)).toEqual([
      'Note text',
      'App UI',
    ])
    for (const column of columns) {
      const names = [...column.querySelectorAll('.typeface-name')].map((n) => n.textContent)
      expect(names).toEqual(['Sans', 'Serif', 'Old style', 'Hybrid', 'Mono'])
    }
    // Each option is drawn in its own face, or the choice is made by name alone.
    expect(columns[0].querySelectorAll<HTMLElement>('.typeface-sample')[1].style.fontFamily).toContain(
      'Georgia',
    )

    // The roles are independent: serif notes, sans app.
    const noteSerif = columns[0].querySelectorAll<HTMLButtonElement>('.theme-typeface')[1]
    act(() => noteSerif.click())
    expect(cssVar('--font-reading')).toContain('Georgia')
    expect(cssVar('--font-ui')).toBe('var(--font-sans)')
    expect(noteSerif.getAttribute('aria-pressed')).toBe('true')
    expect(
      columns[1].querySelectorAll('.theme-typeface')[1].getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('folds Reset into the Advanced section, with no footer row', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    const preset = findPreset(DEFAULT_PRESET_ID)
    const reset = buttonByText(t('themeDialog.reset', { name: t(preset.nameKey) }))
    const advanced = document.querySelector('details.theme-advanced')
    expect(advanced, 'advanced section').not.toBeNull()
    // Reset undoes a customisation: it belongs inside the section that makes
    // one, not loose at the bottom of the dialog.
    expect(advanced!.contains(reset), 'reset inside Advanced').toBe(true)
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

    act(() => buttonByText(t('themeDialog.clearOverrides')).click())
    expect(cssVar('--color-bg-2')).toBe(original)
  })

  it('reports the chosen theme inside a normal dialog shell', () => {
    const onClose = vi.fn()
    mount(<ThemeDialog onClose={onClose} />)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.getElementById('theme-heading')?.textContent).toContain('Appearance')
    act(() => buttonByText('Done').click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops the preview and keeps the colour editor folded away', () => {
    mount(<ThemeDialog onClose={() => {}} />)
    expect(document.querySelector('.theme-thumb')).toBeNull()
    expect(document.querySelector('.theme-preview-wrap')).toBeNull()

    const advanced = document.querySelector<HTMLDetailsElement>('details.theme-advanced')
    expect(advanced, 'advanced section').not.toBeNull()
    expect(advanced?.open, 'collapsed by default').toBe(false)
    expect(advanced?.querySelector('summary')?.textContent?.trim()).toBe('Advanced')
  })
})
