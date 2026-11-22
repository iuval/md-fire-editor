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
    expect(byLabel(el, 'Show panel')).not.toBeNull()
    expect(byLabel(el, 'New note')).not.toBeNull()
    expect(byLabel(el, 'New folder')).not.toBeNull()
    expect(byLabel(el, 'New canvas')).not.toBeNull()
    expect(byLabel(el, 'Account and settings')).not.toBeNull()
  })

  it('runs each action', () => {
    const calls: string[] = []
    const el = renderRail(true, calls)
    for (const label of ['Show panel', 'New note', 'New folder', 'New canvas', 'Account and settings']) {
      act(() => byLabel(el, label)!.click())
    }
    expect(calls).toEqual(['expand', 'note', 'folder', 'canvas', 'account'])
  })

  it('marks the account menu with the same gear as the footer', () => {
    const el = renderRail(true)
    const account = byLabel(el, 'Account and settings')!
    // A gear (lucide "settings"), not a row's "more" glyph: this is the
    // preferences entry, and the expanded panel's footer shows the same one.
    expect(account.querySelector('svg')?.getAttribute('class')).toContain('settings')
  })

  it('is empty while the panel is open, so its buttons cannot be tabbed to', () => {
    const el = renderRail(false)
    expect(el.querySelector('.sidebar-rail')).not.toBeNull()
    expect(el.querySelectorAll('button').length).toBe(0)
  })
})
