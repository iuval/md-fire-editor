// @vitest-environment jsdom
/**
 * El panel de ajustes, que reemplazó al menú de la cuenta: una sola ventana
 * con las secciones al costado en escritorio, y una página completa con
 * navegación hacia adentro en el teléfono.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsDialog, type SettingsTab } from '../src/components/SettingsDialog'
import { t } from '../src/i18n/index.ts'

let roots: Root[] = []
let host: HTMLDivElement | null = null

const tabs: SettingsTab[] = [
  { id: 'account', label: 'Account', icon: <span aria-hidden="true">A</span>, content: <p>account body</p> },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: <span aria-hidden="true">P</span>,
    hint: 'Theme and typefaces',
    content: <p>appearance body</p>,
  },
  { id: 'vault', label: 'Vault', icon: <span aria-hidden="true">V</span>, content: <p>vault body</p> },
]

function mount(over: { mobile?: boolean; onClose?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn()
  host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() =>
    root.render(
      <SettingsDialog
        tabs={tabs}
        title="Ana"
        subtitle="ana@example.com"
        initialTab="account"
        mobile={over.mobile ?? false}
        onClose={onClose}
      />
    )
  )
  return { onClose }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').trim() === text
  )
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found
}

function tabsByRole(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
}

function press(key: string, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

describe('settings, desktop', () => {
  it('puts every section in one dialog, as a vertical tablist', () => {
    mount()
    const list = document.querySelector('[role="tablist"]')
    expect(list?.getAttribute('aria-orientation')).toBe('vertical')
    expect(tabsByRole().map((tab) => tab.textContent?.trim())).toEqual([
      'AAccount',
      'PAppearance',
      'VVault',
    ])
    expect(tabsByRole()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('shows one section at a time, wired to its tab', () => {
    mount()
    expect(document.body.textContent).toContain('account body')
    expect(document.body.textContent).not.toContain('appearance body')

    act(() => tabsByRole()[1].click())

    expect(tabsByRole()[1].getAttribute('aria-selected')).toBe('true')
    expect(tabsByRole()[0].getAttribute('aria-selected')).toBe('false')
    expect(document.body.textContent).toContain('appearance body')
    expect(document.body.textContent).not.toContain('account body')

    const panel = document.querySelector('[role="tabpanel"]')
    expect(panel?.getAttribute('aria-labelledby')).toBe('settings-tab-appearance')
    expect(tabsByRole()[1].getAttribute('aria-controls')).toBe(panel?.id)
  })

  it('walks the tablist with the arrow keys', () => {
    mount()
    tabsByRole()[0].focus()
    press('ArrowDown', tabsByRole()[0])
    expect(document.activeElement).toBe(tabsByRole()[1])
    expect(tabsByRole()[1].getAttribute('aria-selected')).toBe('true')

    press('End', tabsByRole()[1])
    expect(document.activeElement).toBe(tabsByRole()[2])
    expect(tabsByRole()[2].getAttribute('aria-selected')).toBe('true')

    // Wraps around instead of stopping at the last section.
    press('ArrowDown', tabsByRole()[2])
    expect(document.activeElement).toBe(tabsByRole()[0])
  })

  it('closes with Escape, like any other dialog', () => {
    const { onClose } = mount()
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('settings, phone', () => {
  it('opens as a full page whose first screen lists the sections', () => {
    mount({ mobile: true })
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.settings-row')]
    expect(rows.map((row) => row.querySelector('.settings-row-label')?.textContent)).toEqual([
      'Account',
      'Appearance',
      'Vault',
    ])
    // The hint travels with the row, so a phone shows what is behind it.
    expect(rows[1].textContent).toContain('Theme and typefaces')
    // The name and the email say whose panel this is.
    expect(document.body.textContent).toContain('Ana')
    expect(document.body.textContent).toContain('ana@example.com')
    // The list leads; no section is open yet.
    expect(document.body.textContent).not.toContain('account body')
  })

  it('pushes a section page with a way back in the header', () => {
    mount({ mobile: true })
    act(() => buttonByText('PAppearanceTheme and typefaces').click())

    expect(document.body.textContent).toContain('appearance body')
    const back = buttonByLabel(t('settings.back'))
    expect(back.closest('.settings-head'), 'back lives in the header').not.toBeNull()
    // The page names itself, under the header.
    expect(document.querySelector('.settings-page-title')?.textContent).toBe('Appearance')
  })

  it('goes back to the list from the header button', () => {
    mount({ mobile: true })
    act(() => buttonByText('AAccount').click())
    expect(document.body.textContent).toContain('account body')

    act(() => buttonByLabel(t('settings.back')).click())
    expect(document.body.textContent).not.toContain('account body')
    expect(document.querySelectorAll('.settings-row')).toHaveLength(3)
  })

  it('closes from the header at either depth', () => {
    const { onClose } = mount({ mobile: true })
    act(() => buttonByText('VVault').click())
    act(() => document.querySelector<HTMLButtonElement>('.settings-head .icon-btn')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
