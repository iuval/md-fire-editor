// @vitest-environment jsdom
/**
 * La lista de agentes conectados. Lo que se prueba es el contrato con la app:
 * que muestre la lista, que renombre por el callback y que el pareado anónimo
 * siga disponible pero plegado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentsDialog } from '../src/components/AgentsDialog'
import type { Agent } from '../src/lib/agents'

let root: Root | null = null
let host: HTMLDivElement | null = null

function mount(
  agents: Agent[],
  onRename = vi.fn(async () => undefined),
  error: string | null = null
) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <AgentsDialog
        agents={agents}
        error={error}
        folders={[]}
        onRename={onRename}
        onLink={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    )
  )
  return { host, onRename }
}

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: '3f9a1c2b',
  name: 'MacBook de Ana',
  kind: 'cli',
  createdAt: new Date('2026-01-01T10:00:00Z'),
  lastSeenAt: new Date(Date.now() - 60_000),
  ...over,
})

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

describe('lista de agentes', () => {
  it('muestra el nombre de cada agente', () => {
    mount([agent(), agent({ id: '9d2e4f01', name: 'iPad' })])
    const text = document.body.textContent ?? ''
    expect(text).toContain('MacBook de Ana')
    expect(text).toContain('iPad')
  })

  it('explica qué hacer cuando no hay ninguno', () => {
    mount([])
    expect(document.body.textContent).toContain('Todavía no hay agentes')
    expect(document.body.textContent).toContain('mdfire login')
  })

  it('renombra por el callback y sale del modo edición', async () => {
    const { onRename } = mount([agent()])
    const pencil = document.querySelector<HTMLButtonElement>('[aria-label="Renombrar MacBook de Ana"]')
    expect(pencil).not.toBeNull()

    act(() => pencil!.click())
    const input = document.querySelector<HTMLInputElement>('[aria-label="Nombre de MacBook de Ana"]')
    expect(input).not.toBeNull()

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input!, 'Notebook')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Guardar nombre"]')!.click()
    })

    expect(onRename).toHaveBeenCalledWith('3f9a1c2b', 'Notebook')
    expect(document.querySelector('[aria-label="Nombre de MacBook de Ana"]')).toBeNull()
  })

  it('no renombra a vacío', async () => {
    const { onRename } = mount([agent()])
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Renombrar MacBook de Ana"]')!.click())
    const input = document.querySelector<HTMLInputElement>('[aria-label="Nombre de MacBook de Ana"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '   ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Guardar nombre"]')!.click()
    })
    expect(onRename).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('El nombre no puede quedar vacío')
  })

  it('deja el pareado anónimo plegado', () => {
    mount([agent()])
    const details = document.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(details!.textContent).toContain('Vincular un agente anónimo')
  })

  it('avisa cuando el listener falla', () => {
    mount([], undefined, 'Missing or insufficient permissions')
    expect(document.body.textContent).toContain('No se pudo cargar la lista')
    expect(document.body.textContent).toContain('reglas')
  })

  it('muestra el último uso en lenguaje humano', () => {
    mount([agent({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })])
    expect(document.body.textContent).toContain('hace 5 min')
  })
})
