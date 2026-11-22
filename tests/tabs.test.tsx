// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabStrip } from '../src/components/TabStrip'
import { MAX_PANES } from '../src/lib/panes'
import { Workspace } from '../src/components/Workspace'
import { singlePane, splitPane, type PaneLeaf } from '../src/lib/panes'

let roots: Root[] = []

function mount(ui: React.ReactNode) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
})

const tabs = [
  { id: 't1', title: 'Primera' },
  { id: 't2', title: 'Segunda' },
  { id: 't3', title: 'Tercera' },
]

function strip(handlers: Partial<Parameters<typeof TabStrip>[0]> = {}) {
  return mount(
    <TabStrip
      tabs={tabs}
      activeTabId="t2"
      onActivate={() => {}}
      onClose={() => {}}
      onNewNote={() => {}}
      {...handlers}
    />
  )
}

describe('tab strip', () => {
  it('marks the active tab and activates the clicked one', () => {
    const activated: string[] = []
    const el = strip({ onActivate: (id) => activated.push(id) })
    const rendered = Array.from(el.querySelectorAll('[role="tab"]'))
    expect(rendered.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
    ;(rendered[2] as HTMLElement).click()
    expect(activated).toEqual(['t3'])
  })

  it('closes the tab whose × was pressed', () => {
    const closed: string[] = []
    const el = strip({ onClose: (id) => closed.push(id) })
    ;(el.querySelectorAll('.tab-close')[0] as HTMLElement).click()
    expect(closed).toEqual(['t1'])
  })

  it('has no ⋯ menu on the pane: no popup, no context menu', () => {
    const el = strip({ onSplitRight: () => {}, onSplitDown: () => {}, onClosePane: () => {} })
    expect(el.querySelector('[aria-label="Opciones del panel"]')).toBeNull()
    expect(el.querySelector('[aria-haspopup="menu"]')).toBeNull()
    // A right click on a tab used to open that menu; now it does nothing.
    const tab = el.querySelector('.tab')!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => tab.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
  })

  it('splits right and down from two plain buttons', () => {
    const calls: string[] = []
    const el = strip({
      onSplitRight: () => calls.push('right'),
      onSplitDown: () => calls.push('down'),
    })
    ;(el.querySelector('[aria-label="Dividir a la derecha"]') as HTMLElement).click()
    ;(el.querySelector('[aria-label="Dividir abajo"]') as HTMLElement).click()
    expect(calls).toEqual(['right', 'down'])
  })

  it('offers no split buttons on a phone, which shows one pane', () => {
    const el = strip()
    expect(el.querySelector('[aria-label="Dividir a la derecha"]')).toBeNull()
    expect(el.querySelector('[aria-label="Dividir abajo"]')).toBeNull()
  })

  it('greys both splits out, with the reason, once the budget is spent', () => {
    // Built from the budget itself: a hardcoded number here would keep passing
    // after MAX_PANES changes, and would lie about the label the app shows.
    const limit = `Máximo de paneles (${MAX_PANES})`
    const el = strip({ onSplitRight: () => {}, onSplitDown: () => {}, splitLimitLabel: limit })
    for (const label of ['Dividir a la derecha', 'Dividir abajo']) {
      const button = el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('title')).toBe(limit)
    }
  })

  it('moves focus between tabs with the arrow keys, wrapping at the ends', () => {
    const activated: string[] = []
    const el = strip({ onActivate: (id) => activated.push(id) })
    const rendered = Array.from(el.querySelectorAll('[role="tab"]')) as HTMLElement[]
    rendered[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    rendered[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(activated).toEqual(['t1', 't3'])
  })

  it('puts the + right after the last tab, inside the tab list', () => {
    const el = strip()
    const children = Array.from(el.querySelector('.tabbar-tabs')!.children) as HTMLElement[]
    expect(children).toHaveLength(tabs.length + 1)
    expect(children.at(-2)!.className).toContain('tab')
    expect(children.at(-1)!.className).toContain('tab-new')
    expect(children.at(-1)!.getAttribute('aria-label')).toBe('Nueva nota')
  })

  it('adds a note from the + next to the tabs', () => {
    let added = 0
    const el = strip({ onNewNote: () => added++ })
    ;(el.querySelector('.tab-new') as HTMLElement).click()
    expect(added).toBe(1)
  })

  it('paints no chrome of its own when it lives in the top bar', () => {
    const el = strip({ compact: true, onSplitRight: () => {}, onSplitDown: () => {} })
    expect(el.querySelector('.tabbar')!.className).toContain('tabbar--inline')
    expect(el.querySelector('.tab-new')).not.toBeNull()
    // Same three actions as a pane strip, just without its own bar.
    expect(el.querySelector('[aria-label="Dividir a la derecha"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Cerrar panel"]')).toBeNull()
  })

  it('closes the whole pane from the X on the right', () => {
    let closed = 0
    const el = strip({ onClosePane: () => closed++ })
    const actions = Array.from(el.querySelectorAll('.tabbar-actions button')) as HTMLElement[]
    const close = actions.at(-1)!
    expect(close.getAttribute('aria-label')).toBe('Cerrar panel')
    expect(close.querySelector('svg')).not.toBeNull()
    close.click()
    expect(closed).toBe(1)
  })

  it('offers no pane X when there is nothing to close', () => {
    const el = strip()
    expect(el.querySelector('[aria-label="Cerrar panel"]')).toBeNull()
  })
})

function leaf(id: string): PaneLeaf {
  return singlePane(id, `note-${id}`, `tab-${id}`)
}

function renderWorkspace(tree: ReturnType<typeof splitPane>, focused: string, isMobile = false) {
  return mount(
    <Workspace
      tree={tree}
      focusedPaneId={focused}
      isMobile={isMobile}
      renderPane={(pane) => <div data-pane={pane.id}>{pane.id}</div>}
      onFocusPane={() => {}}
      onRatio={() => {}}
    />
  )
}

describe('workspace splits', () => {
  const sideBySide = splitPane(leaf('p1'), 'p1', 'row', leaf('p2'), 's1')

  it('renders both panes of a horizontal split with a draggable divider', () => {
    const el = renderWorkspace(sideBySide, 'p1')
    expect(el.querySelectorAll('[data-pane]')).toHaveLength(2)
    const divider = el.querySelector('[role="separator"]')!
    expect(divider.getAttribute('aria-orientation')).toBe('vertical')
    expect(el.querySelector('.split')!.className).toContain('split--row')
  })

  it('renders a vertical split as a column', () => {
    const tree = splitPane(leaf('p1'), 'p1', 'column', leaf('p2'), 's1')
    const el = renderWorkspace(tree, 'p1')
    expect(el.querySelector('.split')!.className).toContain('split--column')
    expect(el.querySelector('[role="separator"]')!.getAttribute('aria-orientation')).toBe(
      'horizontal'
    )
  })

  it('keeps the ratio as the flex share of each cell', () => {
    const tree = { ...(sideBySide as Extract<typeof sideBySide, { kind: 'split' }>), ratio: 0.7 }
    const el = renderWorkspace(tree, 'p1')
    const cells = Array.from(el.querySelectorAll('.split-cell')) as HTMLElement[]
    expect(cells[0].style.flex).toBe('0.7 1 0px')
    expect(cells[1].style.flex).toBe('0.3 1 0px')
  })

  it('shows only the focused pane on a phone', () => {
    const el = renderWorkspace(sideBySide, 'p2', true)
    const panes = el.querySelectorAll('[data-pane]')
    expect(panes).toHaveLength(1)
    expect(panes[0].getAttribute('data-pane')).toBe('p2')
    expect(el.querySelector('[role="separator"]')).toBeNull()
  })

  it('nests splits without a depth limit', () => {
    const tree = splitPane(
      splitPane(leaf('p1'), 'p1', 'row', leaf('p2'), 's1'),
      'p2',
      'column',
      leaf('p3'),
      's2'
    )
    const el = renderWorkspace(tree, 'p1')
    expect(el.querySelectorAll('[data-pane]')).toHaveLength(3)
    expect(el.querySelectorAll('[role="separator"]')).toHaveLength(2)
  })
})
