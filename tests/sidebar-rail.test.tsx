// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SidebarRail } from '../src/components/SidebarRail'

let roots: Root[] = []
let host: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

function renderRail(collapsed: boolean, calls: string[] = []) {
  return mount(
    <SidebarRail
      collapsed={collapsed}
      onExpand={() => calls.push('expand')}
      onNewNote={() => calls.push('note')}
      onNewFolder={() => calls.push('folder')}
      onNewCanvas={() => calls.push('canvas')}
      onAccountClick={() => calls.push('account')}
    />
  )
}

const byLabel = (el: HTMLElement, label: string) =>
  el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null

describe('collapsed rail', () => {
  it('shows expand, the three create actions and the account menu', () => {
    const el = renderRail(true)
    expect(el.querySelector('.sidebar-rail')).not.toBeNull()
    expect(byLabel(el, 'Mostrar panel')).not.toBeNull()
    expect(byLabel(el, 'Nueva nota')).not.toBeNull()
    expect(byLabel(el, 'Nueva carpeta')).not.toBeNull()
    expect(byLabel(el, 'Nuevo canvas')).not.toBeNull()
    expect(byLabel(el, 'Cuenta y ajustes')).not.toBeNull()
  })

  it('runs each action', () => {
    const calls: string[] = []
    const el = renderRail(true, calls)
    for (const label of ['Mostrar panel', 'Nueva nota', 'Nueva carpeta', 'Nuevo canvas', 'Cuenta y ajustes']) {
      act(() => byLabel(el, label)!.click())
    }
    expect(calls).toEqual(['expand', 'note', 'folder', 'canvas', 'account'])
  })

  it('gives the account menu its own icon, not the footer\'s ⋯', () => {
    const el = renderRail(true)
    const account = byLabel(el, 'Cuenta y ajustes')!
    // A gear (lucide "settings"), not the row/footer "more" glyph.
    expect(account.querySelector('svg')?.getAttribute('class')).toContain('settings')
  })

  it('is empty while the panel is open, so its buttons cannot be tabbed to', () => {
    const el = renderRail(false)
    expect(el.querySelector('.sidebar-rail')).not.toBeNull()
    expect(el.querySelectorAll('button').length).toBe(0)
  })
})
