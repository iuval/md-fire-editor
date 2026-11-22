// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PaneBar } from '../src/components/PaneBar'
import type { ProviderStatus } from '../src/lib/collab/provider'

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

const status: ProviderStatus = { connected: true, pendingWrites: 0, updateCount: 0, error: null }

function renderBar(overrides: Partial<ProviderStatus> = {}) {
  return mount(
    <PaneBar
      status={{ ...status, ...overrides }}
      presence={[]}
      sidebarCollapsed={false}
      isMobile={false}
      onToggleSidebar={() => {}}
      onMenu={() => {}}
      menuOpen={false}
    />
  )
}

describe('pane bar slots', () => {
  it('hosts the tab strip in the middle, before the actions', () => {
    const el = mount(
      <PaneBar
        status={status}
        presence={[]}
        sidebarCollapsed={false}
        isMobile={false}
        onToggleSidebar={() => {}}
        onMenu={() => {}}
        menuOpen={false}
        tabs={<span data-testid="tabs">pestañas</span>}
      />
    )
    const head = el.querySelector('.pane-head')!
    const slot = head.querySelector('.pane-head-tabs')!
    const menu = head.querySelector('[aria-label="Más acciones"]')!

    expect(slot.textContent).toBe('pestañas')
    expect(slot.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the spacer when no strip is passed', () => {
    const el = renderBar()
    expect(el.querySelector('.pane-head-tabs')).toBeNull()
  })
})

describe('pane bar sync', () => {
  it('no longer paints a visible sync chip in the top bar', () => {
    const el = renderBar()
    expect(el.querySelector('.sync')).toBeNull()
    expect(el.querySelector('.sync-dot')).toBeNull()
    expect(el.querySelector('.sync-text')).toBeNull()
  })

  it('keeps a screen-reader live region so status changes are announced', () => {
    const el = renderBar({ pendingWrites: 2 })
    const live = el.querySelector('[role="status"]')!
    expect(live.className).toContain('sr-only')
    expect(live.textContent).toBe('Guardando')
  })
})
