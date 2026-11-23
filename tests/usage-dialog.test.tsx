// @vitest-environment jsdom
/**
 * El diálogo de uso: cuota gratuita visible, packs de recarga y guardado de la
 * configuración de auto top-up. La lógica pura vive en quota/credits; acá se
 * prueba el contrato con la app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UsageDialog } from '../src/components/UsageDialog'
import type { UsageTotals } from '../src/lib/usage'
import { FREE_TIER } from '../src/lib/quota'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

const usage: UsageTotals = {
  day: '2026-11-22',
  writes: 4100,
  reads: 5300,
  deletes: 3600,
  bytesWritten: 1000,
  bytesRead: 2000,
  storageBytes: 20 * 1024 * 1024,
  agentOps: 120,
}

function mount(
  overrides: Partial<Parameters<typeof UsageDialog>[0]> = {}
) {
  const onUpdateCredits = vi.fn(async () => undefined)
  const onRequestTopUp = vi.fn(async () => undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <UsageDialog
        usage={usage}
        credits={{ balanceUsd: 3.5, thresholdUsd: 1, topUpUsd: 5, autoTopUp: false }}
        notes={12}
        folders={3}
        diagnostics={{
          usedHeap: null,
          heapLimit: null,
          domNodes: 0,
          openNoteSessions: 0,
          pendingBodies: { count: 0, characters: 0 },
          storage: null,
        }}
        onRefreshDiagnostics={vi.fn()}
        onMigrateBodies={vi.fn()}
        onUpdateCredits={onUpdateCredits}
        onRequestTopUp={onRequestTopUp}
        onClose={vi.fn()}
        {...overrides}
      />
    )
  )
  return { host: document.body, onUpdateCredits, onRequestTopUp }
}

/** Tabs hide the panels they do not own, so a test has to pick one first. */
function clickTab(host: HTMLElement, name: string) {
  const tab = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent?.trim() === name
  )
  if (!tab) throw new Error(`no encontré la pestaña "${name}"`)
  act(() => tab.click())
  return tab
}

function clickText(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(text)
  )
  if (!button) throw new Error(`no encontré el botón "${text}"`)
  act(() => button.click())
  return button
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

describe('diálogo de uso', () => {
  it('muestra la cuota diaria y el uso del día', () => {
    const { host } = mount()
    expect(host.textContent).toContain('Daily quota')
    expect(host.textContent).toContain('Operations')
    expect(host.textContent).toContain('20.0 MB')
    expect(host.textContent).toContain(`${FREE_TIER.opsPerDay.toLocaleString('en-US')}`)
    expect(host.textContent).toContain('2026-11-22')
  })

  it('muestra la cuenta admin sin tope ni fee', () => {
    const { host } = mount({ isAdmin: true })
    expect(host.textContent).toContain('Quota (admin)')
    expect(host.textContent).toContain('No limit')
    expect(host.textContent).toContain('Admin')
    expect(host.textContent).toContain('$0.00')
  })

  it('reparte el contenido en tres pestañas', () => {
    const { host } = mount()
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Usage', 'Balance', 'Diagnostics'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    expect(panels).toHaveLength(3)
    expect(panels[0].hidden).toBe(false)
    expect(panels[1].hidden).toBe(true)
    expect(panels[2].hidden).toBe(true)

    clickTab(host, 'Balance')
    expect(panels[0].hidden).toBe(true)
    expect(panels[1].hidden).toBe(false)
    expect(panels[1].textContent).toContain('Prepaid balance')
  })

  it('pide un pack de recarga', () => {
    const { host, onRequestTopUp } = mount()
    clickTab(host, 'Balance')
    clickText(host, 'Top up $1')
    expect(onRequestTopUp).toHaveBeenCalledWith(1)
  })

  it('guarda la configuración de auto top-up', () => {
    const { host, onUpdateCredits } = mount()
    clickTab(host, 'Balance')
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => checkbox.click())
    clickText(host, 'Save')
    expect(onUpdateCredits).toHaveBeenCalledWith({
      thresholdUsd: 1,
      topUpUsd: 5,
      autoTopUp: true,
    })
  })

  it('no guarda una configuración inválida', () => {
    const { host, onUpdateCredits } = mount()
    clickTab(host, 'Balance')
    const amount = host.querySelector<HTMLInputElement>(
      '[aria-label="Auto top-up amount"]'
    )!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(amount, '1')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickText(host, 'Save')
    expect(onUpdateCredits).not.toHaveBeenCalled()
  })
})
