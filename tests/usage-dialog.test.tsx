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
  month: '2026-11',
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
  it('muestra la cuota mensual y el uso del mes', () => {
    const { host } = mount()
    expect(host.textContent).toContain('Cuota mensual')
    expect(host.textContent).toContain('Operaciones')
    expect(host.textContent).toContain('120')
    expect(host.textContent).toContain('20.0 MB')
    expect(host.textContent).toContain(`${FREE_TIER.opsPerMonth.toLocaleString('es')}`)
  })

  it('muestra la cuenta admin sin tope ni fee', () => {
    const { host } = mount({ isAdmin: true })
    expect(host.textContent).toContain('Cuota (admin)')
    expect(host.textContent).toContain('Sin límite')
    expect(host.textContent).toContain('Admin (sin cargos)')
    expect(host.textContent).toContain('$0.00')
  })

  it('pide un pack de recarga', () => {
    const { host, onRequestTopUp } = mount()
    clickText(host, 'Recargar $5')
    expect(onRequestTopUp).toHaveBeenCalledWith(5)
  })

  it('guarda la configuración de auto top-up', () => {
    const { host, onUpdateCredits } = mount()
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => checkbox.click())
    clickText(host, 'Guardar')
    expect(onUpdateCredits).toHaveBeenCalledWith({
      thresholdUsd: 1,
      topUpUsd: 5,
      autoTopUp: true,
    })
  })

  it('no guarda una configuración inválida', () => {
    const { host, onUpdateCredits } = mount()
    const numbers = host.querySelectorAll('input[type="number"]')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(numbers[1], '1')
      numbers[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickText(host, 'Guardar')
    expect(onUpdateCredits).not.toHaveBeenCalled()
  })
})
