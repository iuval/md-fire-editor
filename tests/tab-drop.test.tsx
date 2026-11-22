// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PaneDropTarget } from '../src/components/PaneDropTarget'
import { beginTabDrag, currentTabDrag, endTabDrag, type DropZone } from '../src/lib/tabDrag'

let roots: Root[] = []
let clearDrag: (() => void) | null = null

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
  clearDrag?.()
  clearDrag = null
  endTabDrag()
})

/** The pointer coordinates in these tests are pixels inside an 800×400 pane. */
function target(options: { paneId?: string; tabCount?: number; canSplit?: boolean } = {}) {
  const dropped: [string, DropZone][] = []
  clearDrag = beginDrag({ paneId: options.paneId ?? 'p1', tabId: 't1' })
  const el = mount(
    <PaneDropTarget
      paneId={options.paneId ?? 'p2'}
      tabCount={options.tabCount ?? 2}
      canSplit={options.canSplit ?? true}
      onDrop={(source, zone) => dropped.push([source.paneId, zone])}
    />
  )
  const surface = el.querySelector('.pane-drop') as HTMLElement
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0 }) as DOMRect
  const zone = () => surface.getAttribute('data-zone')
  return { el, surface, zone, dropped }
}

/** Starts a drag from `source` and returns the cleanup for the body class. */
function beginDrag(source: { paneId: string; tabId: string }) {
  beginTabDrag(source)
  return () => endTabDrag()
}

function fire(el: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  act(() => el.dispatchEvent(event))
  return event
}

describe('dropping a dragged tab on a pane', () => {
  it('paints the half a side drop would turn into a new pane', () => {
    const { surface, zone } = target()
    fire(surface, 'dragover', 20, 200)
    expect(zone()).toBe('left')
    expect(surface.textContent).toBe('Dividir a la izquierda')

    fire(surface, 'dragover', 780, 200)
    expect(zone()).toBe('right')
    expect(surface.textContent).toBe('Dividir a la derecha')

    fire(surface, 'dragover', 400, 20)
    expect(zone()).toBe('top')
    expect(surface.textContent).toBe('Dividir arriba')

    fire(surface, 'dragover', 400, 380)
    expect(zone()).toBe('bottom')
    expect(surface.textContent).toBe('Dividir abajo')
  })

  it('highlights the whole pane for a move, and allows the browser drop', () => {
    const { surface, zone } = target()
    const event = fire(surface, 'dragover', 400, 200)
    expect(zone()).toBe('center')
    expect(surface.textContent).toBe('Mover acá')
    // Without preventDefault the browser refuses the drop altogether.
    expect(event.defaultPrevented).toBe(true)
  })

  it('offers nothing when the tab is already in this pane', () => {
    const { surface, zone } = target({ paneId: 'p1' })
    fire(surface, 'dragover', 400, 200)
    expect(zone()).toBeNull()
    expect(surface.textContent).toBe('')
  })

  it('offers nothing for a stray dragover with no tab in flight', () => {
    endTabDrag()
    const el = mount(
      <PaneDropTarget paneId="p2" tabCount={1} canSplit onDrop={() => {}} />
    )
    const surface = el.querySelector('.pane-drop') as HTMLElement
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0 }) as DOMRect
    fire(surface, 'dragover', 20, 200)
    expect(surface.getAttribute('data-zone')).toBeNull()
  })

  it('refuses a split once the pane budget is spent, but still moves', () => {
    const { surface, zone } = target({ canSplit: false })
    fire(surface, 'dragover', 20, 200)
    expect(zone()).toBeNull()
    fire(surface, 'dragover', 400, 200)
    expect(zone()).toBe('center')
  })

  it('refuses to split a pane against the only tab it holds', () => {
    const { surface, zone } = target({ paneId: 'p1', tabCount: 1 })
    fire(surface, 'dragover', 20, 200)
    expect(zone()).toBeNull()
  })

  it('drops the tab where the highlight promised', () => {
    const { surface, zone, dropped } = target()
    fire(surface, 'dragover', 780, 200)
    fire(surface, 'drop', 780, 200)
    expect(dropped).toEqual([['p1', 'right']])
    expect(zone()).toBeNull()
    // The session ends with the drop: the overlays stop listening everywhere.
    expect(currentTabDrag()).toBeNull()
    expect(document.body.classList.contains('tab-dragging')).toBe(false)
  })

  it('clears the highlight when the pointer leaves the pane', () => {
    const { surface, zone } = target()
    fire(surface, 'dragover', 20, 200)
    expect(zone()).toBe('left')
    fire(surface, 'dragleave', 0, 0)
    expect(zone()).toBeNull()
  })
})
