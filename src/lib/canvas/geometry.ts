/**
 * Canvas geometry: the pure math behind every interaction, kept out of React so
 * pan/zoom/drag/resize can be tested without a browser (this environment has
 * none, and geometry bugs are invisible until someone drags a card).
 *
 * The world is in canvas pixels, exactly like the numbers in the file: node
 * `x`/`y`/`width`/`height` are world coordinates, and the viewport is one
 * `translate(x, y) scale(zoom)`.
 */

import type { CanvasNode, CanvasSide, CanvasEdge } from './model'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const MIN_NODE_WIDTH = 40
export const MIN_NODE_HEIGHT = 30
export const SNAP_STEP = 20
/** Padding around the content for "zoom to fit", in screen pixels. */
export const FIT_PADDING = 48

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function rectOf(node: { x: number; y: number; width: number; height: number }): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

export function right(rect: Rect): number {
  return rect.x + rect.width
}

export function bottom(rect: Rect): number {
  return rect.y + rect.height
}

export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x = Infinity
  let y = Infinity
  let rightEdge = -Infinity
  let bottomEdge = -Infinity
  for (const rect of rects) {
    x = Math.min(x, rect.x)
    y = Math.min(y, rect.y)
    rightEdge = Math.max(rightEdge, right(rect))
    bottomEdge = Math.max(bottomEdge, bottom(rect))
  }
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

/** The point an edge attaches to, on one side of a card. */
export function sidePoint(rect: Rect, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: bottom(rect) }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 }
    case 'right':
      return { x: right(rect), y: rect.y + rect.height / 2 }
  }
}

/** Outward normal of a side, used to bend the curve away from the card. */
function normal(side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

/**
 * Which side faces the other card. Obsidian picks the sides you would pick:
 * the pair with the shortest gap, preferring the axis where the cards are
 * separated.
 */
export function autoSides(from: Rect, to: Rect): { fromSide: CanvasSide; toSide: CanvasSide } {
  const dx = centerOf(to).x - centerOf(from).x
  const dy = centerOf(to).y - centerOf(from).y
  const horizontalGap = Math.max(0, Math.max(from.x, to.x) - Math.min(right(from), right(to)))
  const verticalGap = Math.max(0, Math.max(from.y, to.y) - Math.min(bottom(from), bottom(to)))

  if (horizontalGap > 0 || verticalGap > 0) {
    if (horizontalGap >= verticalGap) {
      return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
    }
    return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' }
  }
  // Overlapping: fall back to whatever is further apart.
  return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
}

/** Distance the control points leave the card: shorter for close cards. */
function bend(from: Rect, to: Rect): number {
  const distance = Math.hypot(centerOf(to).x - centerOf(from).x, centerOf(to).y - centerOf(from).y)
  return Math.min(160, Math.max(36, distance / 2.4))
}

/**
 * SVG path for one connection: a cubic curve that leaves each card
 * perpendicular to its side, the shape Obsidian draws.
 */
export function edgePath(
  from: Rect,
  to: Rect,
  fromSide?: CanvasSide,
  toSide?: CanvasSide
): string {
  const chosen = autoSides(from, to)
  const startSide = fromSide ?? chosen.fromSide
  const endSide = toSide ?? chosen.toSide
  const start = sidePoint(from, startSide)
  const end = sidePoint(to, endSide)
  const offset = bend(from, to)
  const startNormal = normal(startSide)
  const endNormal = normal(endSide)
  const c1 = { x: start.x + startNormal.x * offset, y: start.y + startNormal.y * offset }
  const c2 = { x: end.x + endNormal.x * offset, y: end.y + endNormal.y * offset }
  return `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`
}

export interface EdgeGeometry {
  path: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  c1: { x: number; y: number }
  c2: { x: number; y: number }
}

/** The curve plus its control points, so arrowheads can follow the tangent. */
export function edgeGeometry(
  from: Rect,
  to: Rect,
  fromSide?: CanvasSide,
  toSide?: CanvasSide
): EdgeGeometry {
  const chosen = autoSides(from, to)
  const startSide = fromSide ?? chosen.fromSide
  const endSide = toSide ?? chosen.toSide
  const start = sidePoint(from, startSide)
  const end = sidePoint(to, endSide)
  const offset = bend(from, to)
  const startNormal = normal(startSide)
  const endNormal = normal(endSide)
  const c1 = { x: start.x + startNormal.x * offset, y: start.y + startNormal.y * offset }
  const c2 = { x: end.x + endNormal.x * offset, y: end.y + endNormal.y * offset }
  return {
    path: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`,
    start,
    end,
    c1,
    c2,
  }
}

/**
 * Triangle for one end of an edge. `towards` is the control point the curve
 * comes from, which gives the tangent at that endpoint.
 */
export function arrowPolygon(
  point: { x: number; y: number },
  towards: { x: number; y: number },
  size = 11
): string {
  const dx = point.x - towards.x
  const dy = point.y - towards.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const width = size * 0.62
  const baseX = point.x - ux * size
  const baseY = point.y - uy * size
  const leftX = baseX - uy * width
  const leftY = baseY + ux * width
  const rightX = baseX + uy * width
  const rightY = baseY - ux * width
  return `${round(point.x)},${round(point.y)} ${round(leftX)},${round(leftY)} ${round(rightX)},${round(rightY)}`
}

/** Point half-way along a cubic curve, for the edge label. */
export function bezierMidpoint(
  start: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number } {
  // Bezier at t = 0.5: (p0 + 3c1 + 3c2 + p3) / 8.
  return {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  }
}

/** Point half-way along the curve, for the edge label. */
export function edgeMidpoint(
  from: Rect,
  to: Rect,
  fromSide?: CanvasSide,
  toSide?: CanvasSide
): { x: number; y: number } {
  const chosen = autoSides(from, to)
  const start = sidePoint(from, fromSide ?? chosen.fromSide)
  const end = sidePoint(to, toSide ?? chosen.toSide)
  const offset = bend(from, to)
  const startNormal = normal(fromSide ?? chosen.fromSide)
  const endNormal = normal(toSide ?? chosen.toSide)
  const c1 = { x: start.x + startNormal.x * offset, y: start.y + startNormal.y * offset }
  const c2 = { x: end.x + endNormal.x * offset, y: end.y + endNormal.y * offset }
  return bezierMidpoint(start, c1, c2, end)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

// ---------- selection and groups ----------

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
}

/** Marquee semantics match Obsidian: touching a card selects it. */
export function hitByMarquee(marquee: Rect, nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter((node) => rectsIntersect(marquee, rectOf(node)))
}

/** A card belongs to a group when the group fully contains it (like Obsidian). */
export function containsRect(group: Rect, rect: Rect): boolean {
  return (
    rect.x >= group.x &&
    rect.y >= group.y &&
    right(rect) <= right(group) &&
    bottom(rect) <= bottom(group)
  )
}

/**
 * The groups that travel with a card. Nested groups are handled by taking the
 * innermost one and walking out, so moving a card moves every frame that holds
 * it exactly once.
 */
export function groupsHolding(rect: Rect, nodes: CanvasNode[], exclude: Set<string>): CanvasNode[] {
  return nodes.filter(
    (node) => node.type === 'group' && !exclude.has(node.id) && containsRect(rectOf(node), rect)
  )
}

/** A card that a group drag must carry along. */
export function cardsInside(group: Rect, nodes: CanvasNode[], exclude: Set<string>): CanvasNode[] {
  return nodes.filter(
    (node) => !exclude.has(node.id) && node.type !== 'group' && containsRect(group, rectOf(node))
  )
}

// ---------- viewport ----------

/** Screen point → world point, given the viewport and the container's box. */
export function toWorld(
  view: Viewport,
  screen: { x: number; y: number },
  origin: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: (screen.x - origin.x - view.x) / view.zoom,
    y: (screen.y - origin.y - view.y) / view.zoom,
  }
}

/** Zoom keeping the world point under the pointer pinned. */
export function zoomAt(view: Viewport, screen: { x: number; y: number }, nextZoom: number): Viewport {
  const zoom = clampZoom(nextZoom)
  if (zoom === view.zoom) return view
  const ratio = zoom / view.zoom
  return { x: screen.x - (screen.x - view.x) * ratio, y: screen.y - (screen.y - view.y) * ratio, zoom }
}

/** The whole canvas inside the viewport, as Obsidian's "zoom to fit". */
export function fitViewport(
  bounds: Rect | null,
  size: { width: number; height: number },
  padding = FIT_PADDING
): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 }
  const availableWidth = Math.max(1, size.width - padding * 2)
  const availableHeight = Math.max(1, size.height - padding * 2)
  const zoom = clampZoom(
    Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height), 1)
  )
  return {
    x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

// ---------- editing ----------

export function snapValue(value: number, enabled: boolean, step = SNAP_STEP): number {
  return enabled ? Math.round(value / step) * step : Math.round(value)
}

export function alignSelection(
  nodes: CanvasNode[],
  mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
): Map<string, { x: number; y: number }> {
  const moved = new Map<string, { x: number; y: number }>()
  if (nodes.length < 2) return moved
  const bounds = unionRect(nodes.map(rectOf))
  if (!bounds) return moved
  for (const node of nodes) {
    const rect = rectOf(node)
    let { x, y } = rect
    switch (mode) {
      case 'left':
        x = bounds.x
        break
      case 'center':
        x = bounds.x + (bounds.width - rect.width) / 2
        break
      case 'right':
        x = bounds.x + bounds.width - rect.width
        break
      case 'top':
        y = bounds.y
        break
      case 'middle':
        y = bounds.y + (bounds.height - rect.height) / 2
        break
      case 'bottom':
        y = bounds.y + bounds.height - rect.height
        break
    }
    if (x !== node.x || y !== node.y) moved.set(node.id, { x: Math.round(x), y: Math.round(y) })
  }
  return moved
}

/** Edges whose endpoints are gone; deleting a card must not leave them behind. */
export function danglingEdges(edges: CanvasEdge[], nodeIds: Set<string>): CanvasEdge[] {
  return edges.filter((edge) => !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode))
}
