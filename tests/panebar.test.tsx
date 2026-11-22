// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PaneBar } from '../src/components/PaneBar'
import { SyncAnnouncer } from '../src/components/SyncAnnouncer'
import { paneBarNeeded } from '../src/lib/paneBar'
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

function renderBar() {
  return mount(
    <PaneBar presence={[]} isMobile={false} onToggleSidebar={() => {}} />
  )
}

describe('pane bar slots', () => {
  it('gives the whole bar to the tab strip', () => {
    const el = mount(
      <PaneBar
        presence={[]}
        isMobile={false}
        onToggleSidebar={() => {}}
        tabs={<span data-testid="tabs">pestañas</span>}
      />
    )
    const head = el.querySelector('.pane-head')!
    const slot = head.querySelector('.pane-head-tabs')!

    expect(slot.textContent).toBe('pestañas')
    // Nothing actionable sits after the tabs: the file actions moved to the
    // tree rows, so the strip gets the free width instead of a ⋯ eating it.
    const after = [...head.querySelectorAll('button')].filter(
      (button) => slot.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(after).toEqual([])
  })

  it('keeps the spacer when no strip is passed', () => {
    const el = renderBar()
    expect(el.querySelector('.pane-head-tabs')).toBeNull()
  })
})

describe('pane bar actions', () => {
  it('no longer duplicates the tree menu with a ⋯ button', () => {
    const el = renderBar()
    expect(el.querySelector('[aria-label="Más acciones"]')).toBeNull()
  })

  it('leaves the desktop expand button to the collapsed rail', () => {
    const el = renderBar()
    expect(el.querySelector('[aria-label="Mostrar panel"]')).toBeNull()
  })

  it('keeps the drawer opener on a phone', () => {
    const el = mount(<PaneBar presence={[]} isMobile onToggleSidebar={() => {}} />)
    expect(el.querySelector('[aria-label="Open notes"]')).not.toBeNull()
  })
})

describe('sync status', () => {
  it('paints no chip in the top bar', () => {
    const el = renderBar()
    expect(el.querySelector('.sync')).toBeNull()
    expect(el.querySelector('.sync-dot')).toBeNull()
    expect(el.querySelector('.sync-text')).toBeNull()
    expect(el.querySelector('[role="status"]')).toBeNull()
  })

  it('announces the state from its own always-mounted region', () => {
    const el = mount(<SyncAnnouncer status={{ ...status, pendingWrites: 2 }} />)
    const live = el.querySelector('[role="status"]')!
    expect(live.className).toContain('sr-only')
    expect(live.textContent).toBe('Saving')
  })

  it('keeps announcing once the bar is gone from the layout', () => {
    // Nothing here is visual: this is what a split workspace (no top bar) keeps.
    const el = mount(<SyncAnnouncer status={{ ...status, connected: false }} />)
    expect(el.textContent).toBe('Connecting')
  })
})

describe('when the bar exists at all', () => {
  const base = { hasTabs: false, isMobile: false, selectedTags: 0, presence: 0 }

  it('is not rendered for a split workspace with nothing to carry', () => {
    // Two panes keep their tabs in their own strips: an empty row would just
    // eat 34px above them.
    expect(paneBarNeeded(base)).toBe(false)
  })

  it('is rendered for each thing that needs a home up there', () => {
    expect(paneBarNeeded({ ...base, hasTabs: true })).toBe(true)
    expect(paneBarNeeded({ ...base, isMobile: true })).toBe(true)
    expect(paneBarNeeded({ ...base, selectedTags: 1 })).toBe(true)
    expect(paneBarNeeded({ ...base, presence: 1 })).toBe(true)
  })
})
