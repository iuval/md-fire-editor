/**
 * A tab drag: which tab is in flight, and where the pointer says it lands.
 *
 * The session lives in a module instead of React state on purpose. A drag emits
 * dozens of events per second, and lifting each one to the app would re-render
 * every pane — every ProseMirror editor with it. Kept here, only the pane under
 * the pointer paints a target, and the app re-renders once, on the drop.
 */

export interface TabDragSource {
  paneId: string
  tabId: string
}

/** `center` moves the tab into a pane; the four sides split it. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Set on `<body>` while a tab is in flight. The drop overlays listen only with
 * this class (`pointer-events`), so an idle pane can never swallow a click.
 */
export const TAB_DRAG_CLASS = 'tab-dragging'

/** How thick the splitting border is, as a share of the pane and capped in px. */
const EDGE_SHARE = 0.3
const EDGE_MAX_X = 160
const EDGE_MAX_Y = 140

/**
 * Which part of a pane the pointer is over.
 *
 * The four edges split — they are the future panes, so their band is thick
 * enough to hit without aiming (a 30% strip, capped so a very wide pane does
 * not turn its whole left third into a split zone). Everything else is the
 * centre, which moves the tab in without touching the layout.
 */
export function dropZoneAt(rect: RectLike, x: number, y: number): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center'

  const edgeX = Math.min(rect.width * EDGE_SHARE, EDGE_MAX_X)
  const edgeY = Math.min(rect.height * EDGE_SHARE, EDGE_MAX_Y)
  // Distances from each edge, in px: `Infinity` once the pointer is past the band.
  const toLeft = x - rect.left
  const toRight = rect.left + rect.width - x
  const toTop = y - rect.top
  const toBottom = rect.top + rect.height - y

  const horizontal = Math.min(toLeft, toRight)
  const vertical = Math.min(toTop, toBottom)
  const inHorizontal = horizontal <= edgeX && horizontal >= 0
  const inVertical = vertical <= edgeY && vertical >= 0

  if (inHorizontal && inVertical) {
    // A corner belongs to the edge the pointer is closest to.
    return horizontal <= vertical
      ? toLeft <= toRight
        ? 'left'
        : 'right'
      : toTop <= toBottom
        ? 'top'
        : 'bottom'
  }
  if (inHorizontal) return toLeft <= toRight ? 'left' : 'right'
  if (inVertical) return toTop <= toBottom ? 'top' : 'bottom'
  return 'center'
}

/**
 * Where an insertion line goes in a strip of tabs: the count of tabs whose
 * midpoint is left of the pointer, which is `tabs.length` past the last one.
 */
export function dropIndexAt(tabs: RectLike[], x: number): number {
  let index = 0
  for (const tab of tabs) {
    if (x >= tab.left + tab.width / 2) index++
  }
  return index
}

let dragged: TabDragSource | null = null

function setBodyFlag(on: boolean) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle(TAB_DRAG_CLASS, on)
}

export function beginTabDrag(source: TabDragSource): void {
  dragged = source
  setBodyFlag(true)
  if (typeof window === 'undefined') return
  // A drag can end anywhere — outside the window, on a dialog, on a tab that
  // unmounted mid-gesture. The class has to come off wherever it ends, or the
  // overlays keep eating every click in the workspace.
  const stop = () => {
    window.removeEventListener('dragend', stop, true)
    endTabDrag()
  }
  window.addEventListener('dragend', stop, true)
}

export function currentTabDrag(): TabDragSource | null {
  return dragged
}

export function endTabDrag(): void {
  if (dragged === null) return
  dragged = null
  setBodyFlag(false)
}
