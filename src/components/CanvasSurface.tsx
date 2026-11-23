import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlignCenter,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  ArrowLeftRight,
  ArrowRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Grid2x2,
  Maximize2,
  Minus,
  Palette,
  Pencil,
  Plus,
  Settings2,
  Square,
  SquareDashed,
  Trash2,
  Type,
  ZoomIn,
} from 'lucide-react'
import { Menu, type MenuItem } from './Menu'
import { CanvasCard } from './CanvasCard'
import {
  DEFAULT_GROUP_SIZE,
  DEFAULT_TEXT_SIZE,
  MAX_CANVAS_NODES,
  newNodeId,
  textNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from '../lib/canvas/model'
import {
  arrowPolygon,
  cardsInside,
  bezierMidpoint,
  edgeGeometry,
  fitViewport,
  hitByMarquee,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  rectOf,
  snapValue,
  unionRect,
  zoomAt,
  type Rect,
  type Viewport,
} from '../lib/canvas/geometry'
import { resolveCanvasFile, type CanvasFileRef } from '../lib/canvas/files'
import { CANVAS_PRESETS, canvasColor } from '../lib/canvas/colors'
import type { MessageKey } from '../i18n/index.ts'
import type { YCanvas } from '../lib/canvas/yCanvas'
import { useT } from '../i18n/index.ts'

const SNAP_KEY = 'firemd.canvas.snap'

/** Preset ids come from the file format; the label is ours. */
const COLOUR_LABELS: Record<string, MessageKey> = {
  '1': 'canvas.colour.red',
  '2': 'canvas.colour.orange',
  '3': 'canvas.colour.yellow',
  '4': 'canvas.colour.green',
  '5': 'canvas.colour.cyan',
  '6': 'canvas.colour.violet',
}
const MemoCard = memo(CanvasCard)

type MenuState =
  | { kind: 'canvas'; x: number; y: number }
  | { kind: 'card'; id: string; x: number; y: number }
  | { kind: 'edge'; id: string; x: number; y: number }
  | { kind: 'settings'; x: number; y: number }
  | { kind: 'files'; x: number; y: number }
  | { kind: 'color'; ids: string[]; x: number; y: number }

type DragState =
  | { kind: 'pan' }
  | { kind: 'marquee' }
  | { kind: 'move'; ids: string[]; origins: Map<string, Rect>; primary: string }
  | { kind: 'resize'; id: string; handle: string; start: Rect }
  | { kind: 'connect'; from: string; side: CanvasSide }

export interface CanvasSurfaceProps {
  ycanvas: YCanvas
  editable: boolean
  isMobile: boolean
  files: CanvasFileRef[]
  onOpenNote: (noteId: string) => void
}

/**
 * The canvas itself: one world layer, an SVG edge layer, cards, and the pointer
 * state machine for panning, selecting, moving, resizing and connecting.
 *
 * Writes to the shared Y.Doc happen once per interaction (on pointer up, one
 * transaction = one undo step). While dragging, only a local preview rect
 * changes, so a move does not emit a Firestore block per frame.
 */
export function CanvasSurface({ ycanvas, editable, isMobile, files, onOpenNote }: CanvasSurfaceProps) {
  const t = useT()
  const version = useSyncExternalStore(ycanvas.subscribe, ycanvas.getVersion)
  const canvas = useMemo(() => ycanvas.toJSON(), [ycanvas, version])

  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const spaceRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  /** Live touch points, for the two-finger pinch Obsidian uses on tablets. */
  const touchesRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchingRef = useRef(false)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setViewState] = useState<Viewport | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [edgeSelection, setEdgeSelection] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [edgeLabel, setEdgeLabel] = useState<{ id: string; value: string } | null>(null)
  const [preview, setPreview] = useState<Map<string, Rect> | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [connecting, setConnecting] = useState<{
    from: string
    side: CanvasSide
    point: { x: number; y: number }
    target: string | null
  } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [snapGrid, setSnapGrid] = useState(() => {
    try {
      return localStorage.getItem(SNAP_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [readOnly, setReadOnly] = useState(false)
  const canEdit = editable && !readOnly

  const currentView = view ?? { x: 0, y: 0, zoom: 1 }
  viewRef.current = currentView

  const setView = useCallback((next: Viewport | ((value: Viewport) => Viewport)) => {
    setViewState((previous) => {
      const value = previous ?? { x: 0, y: 0, zoom: 1 }
      return typeof next === 'function' ? next(value) : next
    })
  }, [])

  // ---------- derived geometry ----------

  const nodesById = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, node])), [canvas])

  const rects = useMemo(() => {
    const map = new Map<string, Rect>()
    for (const node of canvas.nodes) map.set(node.id, preview?.get(node.id) ?? rectOf(node))
    return map
  }, [canvas, preview])

  const edges = useMemo(() => {
    return canvas.edges
      .map((edge) => {
        const from = rects.get(edge.fromNode)
        const to = rects.get(edge.toNode)
        if (!from || !to) return null
        return { edge, from, to, geometry: edgeGeometry(from, to, edge.fromSide, edge.toSide) }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [canvas.edges, rects])

  const filesByTitle = useMemo(
    () => [...files].sort((a, b) => a.title.localeCompare(b.title)),
    [files]
  )

  // ---------- environment ----------

  // The pane is keyboard-driven as soon as it opens (Delete, Cmd+A, arrows).
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // First paint: show the whole canvas, like Obsidian does when a canvas opens.
  useEffect(() => {
    if (view !== null || size.width === 0) return
    setViewState(fitViewport(unionRect(canvas.nodes.map(rectOf)), size))
  }, [view, size, canvas])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      setView((value) => {
        if (event.ctrlKey || event.metaKey) {
          return zoomAt(value, point, value.zoom * Math.exp(-event.deltaY * 0.0022))
        }
        if (event.shiftKey) return { ...value, x: value.x - event.deltaY }
        return { ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [setView])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement | null
      if (target && target.closest('textarea, input, [contenteditable="true"]')) return
      spaceRef.current = true
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SNAP_KEY, snapGrid ? '1' : '0')
    } catch {
      // Private mode: the setting simply does not persist.
    }
  }, [snapGrid])

  // ---------- coordinate helpers ----------

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const origin = { x: rect?.left ?? 0, y: rect?.top ?? 0 }
    const value = viewRef.current
    return {
      x: (clientX - origin.x - value.x) / value.zoom,
      y: (clientY - origin.y - value.y) / value.zoom,
    }
  }, [])

  const nodeAt = useCallback(
    (point: { x: number; y: number }, exclude?: Set<string>, includeGroups = false): string | null => {
      for (let i = canvas.nodes.length - 1; i >= 0; i--) {
        const node = canvas.nodes[i]
        if (exclude?.has(node.id)) continue
        if (!includeGroups && node.type === 'group') continue
        const rect = rects.get(node.id) ?? rectOf(node)
        if (
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        ) {
          return node.id
        }
      }
      return null
    },
    [canvas.nodes, rects]
  )

  function listen(onMove: (event: PointerEvent) => void, onUp: (event: PointerEvent) => void) {
    const move = (event: PointerEvent) => onMove(event)
    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onUp(event)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---------- selection ----------

  /** Selecting a group carries its cards: Obsidian moves the frame and its content. */
  const expandGroups = useCallback(
    (ids: string[]): string[] => {
      const set = new Set(ids)
      let changed = true
      while (changed) {
        changed = false
        for (const id of Array.from(set)) {
          const node = nodesById.get(id)
          if (!node || node.type !== 'group') continue
          for (const child of cardsInside(rectOf(node), canvas.nodes, set)) {
            set.add(child.id)
            changed = true
          }
        }
      }
      return Array.from(set)
    },
    [canvas.nodes, nodesById]
  )

  const selectOnly = useCallback((id: string | null) => {
    setSelection(id ? [id] : [])
    setEdgeSelection(null)
  }, [])

  const deleteSelection = useCallback(() => {
    if (!canEdit) return
    if (edgeSelection) {
      ycanvas.removeEdges([edgeSelection])
      setEdgeSelection(null)
      return
    }
    if (selection.length === 0) return
    ycanvas.removeNodes(selection)
    setSelection([])
    setEditingId(null)
    setEditingLabelId(null)
  }, [canEdit, edgeSelection, selection, ycanvas])

  const duplicate = useCallback(
    (ids: string[]): string[] => {
      if (!canEdit || ids.length === 0) return []
      const chosen = canvas.nodes.filter((node) => ids.includes(node.id))
      if (chosen.length === 0) return []
      const created: CanvasNode[] = chosen.map((node) => ({
        ...node,
        id: newNodeId(),
        x: node.x + 24,
        y: node.y + 24,
        $extra: node.$extra ? { ...node.$extra } : undefined,
      }))
      const idMap = new Map(chosen.map((node, index) => [node.id, created[index].id]))
      const edges: CanvasEdge[] = canvas.edges
        .filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
        .map((edge) => ({
          ...edge,
          id: newNodeId(),
          fromNode: idMap.get(edge.fromNode)!,
          toNode: idMap.get(edge.toNode)!,
        }))
      ycanvas.addNodes(created, edges)
      return created.map((node) => node.id)
    },
    [canEdit, canvas, ycanvas]
  )

  const runAlign = useCallback(
    (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
      const chosen = canvas.nodes.filter((node) => selection.includes(node.id))
      if (chosen.length < 2) return
      const bounds = unionRect(chosen.map(rectOf))
      if (!bounds) return
      const patches = chosen.map((node) => {
        const rect = rectOf(node)
        let { x, y } = rect
        if (mode === 'left') x = bounds.x
        if (mode === 'center') x = bounds.x + (bounds.width - rect.width) / 2
        if (mode === 'right') x = bounds.x + bounds.width - rect.width
        if (mode === 'top') y = bounds.y
        if (mode === 'middle') y = bounds.y + (bounds.height - rect.height) / 2
        if (mode === 'bottom') y = bounds.y + bounds.height - rect.height
        return { id: node.id, patch: { x: Math.round(x), y: Math.round(y) } }
      })
      ycanvas.updateNodes(patches)
    },
    [canvas.nodes, selection, ycanvas]
  )

  const zoomToFit = useCallback(() => {
    if (size.width === 0) return
    setView(fitViewport(unionRect(canvas.nodes.map(rectOf)), size))
  }, [canvas.nodes, setView, size])

  const zoomToSelection = useCallback(() => {
    const chosen = canvas.nodes.filter((node) => selection.includes(node.id))
    if (chosen.length === 0 || size.width === 0) return
    setView(fitViewport(unionRect(chosen.map(rectOf)), size))
  }, [canvas.nodes, selection, setView, size])

  const zoomBy = useCallback(
    (factor: number) => {
      setView((value) =>
        zoomAt(value, { x: size.width / 2, y: size.height / 2 }, value.zoom * factor)
      )
    },
    [setView, size.height, size.width]
  )

  // ---------- interactions ----------

  const startPan = (event: React.PointerEvent) => {
    dragRef.current = { kind: 'pan' }
    const start = { x: event.clientX, y: event.clientY }
    const origin = viewRef.current
    listen(
      (move) => {
        if (pinchingRef.current) return
        setView({ ...origin, x: origin.x + (move.clientX - start.x), y: origin.y + (move.clientY - start.y) })
      },
      () => {
        dragRef.current = null
      }
    )
  }

  const startMove = (event: React.PointerEvent, ids: string[], primary: string) => {
    dragRef.current = { kind: 'move', ids, origins: new Map(), primary }
    const start = toWorld(event.clientX, event.clientY)
    const origins = new Map<string, Rect>()
    for (const id of ids) {
      const node = nodesById.get(id)
      if (node) origins.set(id, rectOf(node))
    }
    const primaryRect = origins.get(primary)
    let latest: Map<string, Rect> | null = null

    listen(
      (move) => {
        if (pinchingRef.current) return
        const point = toWorld(move.clientX, move.clientY)
        let dx = point.x - start.x
        let dy = point.y - start.y
        if (move.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0
          else dx = 0
        }
        if (snapGrid && !spaceRef.current && primaryRect) {
          dx = snapValue(primaryRect.x + dx, true) - primaryRect.x
          dy = snapValue(primaryRect.y + dy, true) - primaryRect.y
        }
        const next = new Map<string, Rect>()
        for (const [id, rect] of origins) {
          next.set(id, { ...rect, x: Math.round(rect.x + dx), y: Math.round(rect.y + dy) })
        }
        latest = next
        setPreview(next)
      },
      () => {
        const next = latest
        setPreview(null)
        dragRef.current = null
        if (!next) return
        const patches: { id: string; patch: Partial<CanvasNode> }[] = []
        for (const [id, rect] of next) {
          const before = origins.get(id)
          if (!before || (before.x === rect.x && before.y === rect.y)) continue
          patches.push({ id, patch: { x: rect.x, y: rect.y } })
        }
        if (patches.length > 0) ycanvas.updateNodes(patches)
      }
    )
  }

  const startResize = (event: React.PointerEvent, id: string, handle: string) => {
    const startRect = rects.get(id)
    if (!startRect) return
    dragRef.current = { kind: 'resize', id, handle, start: startRect }
    const origin = toWorld(event.clientX, event.clientY)
    let latest: Rect | null = null

    listen(
      (move) => {
        const point = toWorld(move.clientX, move.clientY)
        const dx = point.x - origin.x
        const dy = point.y - origin.y
        let { x, y, width, height } = startRect
        if (handle.includes('e')) width = startRect.width + dx
        if (handle.includes('s')) height = startRect.height + dy
        if (handle.includes('w')) {
          width = startRect.width - dx
          x = startRect.x + dx
        }
        if (handle.includes('n')) {
          height = startRect.height - dy
          y = startRect.y + dy
        }
        if (width < MIN_NODE_WIDTH) {
          if (handle.includes('w')) x = startRect.x + startRect.width - MIN_NODE_WIDTH
          width = MIN_NODE_WIDTH
        }
        if (height < MIN_NODE_HEIGHT) {
          if (handle.includes('n')) y = startRect.y + startRect.height - MIN_NODE_HEIGHT
          height = MIN_NODE_HEIGHT
        }
        const corner = handle.length === 2
        if (move.shiftKey && corner) {
          const ratio = startRect.width / Math.max(1, startRect.height)
          if (Math.abs(width - startRect.width) >= Math.abs(height - startRect.height)) {
            height = width / ratio
            if (handle.includes('n')) y = startRect.y + startRect.height - height
          } else {
            width = height * ratio
            if (handle.includes('w')) x = startRect.x + startRect.width - width
          }
        }
        if (snapGrid && !spaceRef.current) {
          x = snapValue(x, true)
          y = snapValue(y, true)
          width = Math.max(MIN_NODE_WIDTH, snapValue(width, true))
          height = Math.max(MIN_NODE_HEIGHT, snapValue(height, true))
        }
        latest = {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        }
        setPreview(new Map([[id, latest]]))
      },
      () => {
        const next = latest
        setPreview(null)
        dragRef.current = null
        if (!next) return
        ycanvas.updateNodes([{ id, patch: next }])
      }
    )
  }

  const startMarquee = (event: React.PointerEvent, additive: boolean) => {
    dragRef.current = { kind: 'marquee' }
    const start = toWorld(event.clientX, event.clientY)
    const base = additive ? selection : []

    listen(
      (move) => {
        const point = toWorld(move.clientX, move.clientY)
        setMarquee({
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        })
      },
      (up) => {
        const point = toWorld(up.clientX, up.clientY)
        const rect: Rect = {
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        }
        setMarquee(null)
        dragRef.current = null
        if (rect.width < 3 && rect.height < 3) return
        const hits = hitByMarquee(rect, canvas.nodes).map((node) => node.id)
        const next = new Set(base)
        for (const id of hits) next.add(id)
        setSelection(Array.from(next))
        setEdgeSelection(null)
      }
    )
  }

  const startConnect = (id: string, side: CanvasSide) => {
    dragRef.current = { kind: 'connect', from: id, side }
    const excluded = new Set([id])
    listen(
      (move) => {
        const point = toWorld(move.clientX, move.clientY)
        setConnecting({ from: id, side, point, target: nodeAt(point, excluded) })
      },
      (up) => {
        const point = toWorld(up.clientX, up.clientY)
        const target = nodeAt(point, excluded)
        setConnecting(null)
        dragRef.current = null
        if (target) {
          ycanvas.addEdge({
            id: newNodeId(),
            fromNode: id,
            fromSide: side,
            toNode: target,
            toEnd: 'arrow',
          })
          return
        }
        // Dropping the line on empty space creates a card there, like Obsidian.
        const node = textNode(Math.round(point.x) - 40, Math.round(point.y) - 20)
        ycanvas.addNodes([node], [
          { id: newNodeId(), fromNode: id, fromSide: side, toNode: node.id, toEnd: 'arrow' },
        ])
        setSelection([node.id])
      }
    )
  }

  /**
   * Two fingers: pinch zooms around their midpoint and dragging them pans, the
   * gesture Obsidian's mobile canvas documents.
   */
  const startPinch = () => {
    const points = Array.from(touchesRef.current.values())
    if (points.length < 2) return
    pinchingRef.current = true
    dragRef.current = null
    const [a, b] = points
    const startDistance = Math.hypot(a.x - b.x, a.y - b.y) || 1
    const box = containerRef.current?.getBoundingClientRect()
    const origin = viewRef.current
    const startMid = { x: (a.x + b.x) / 2 - (box?.left ?? 0), y: (a.y + b.y) / 2 - (box?.top ?? 0) }

    const move = (event: PointerEvent) => {
      if (!touchesRef.current.has(event.pointerId)) return
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const live = Array.from(touchesRef.current.values())
      if (live.length < 2) return
      const distance = Math.hypot(live[0].x - live[1].x, live[0].y - live[1].y) || 1
      const mid = {
        x: (live[0].x + live[1].x) / 2 - (box?.left ?? 0),
        y: (live[0].y + live[1].y) / 2 - (box?.top ?? 0),
      }
      const zoomed = zoomAt(origin, startMid, origin.zoom * (distance / startDistance))
      setView({
        x: zoomed.x + (mid.x - startMid.x),
        y: zoomed.y + (mid.y - startMid.y),
        zoom: zoomed.zoom,
      })
    }
    const end = (event: PointerEvent) => {
      touchesRef.current.delete(event.pointerId)
      if (touchesRef.current.size >= 2) return
      pinchingRef.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return
    if (event.pointerType === 'touch') {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchesRef.current.size === 2) {
        startPinch()
        return
      }
      if (touchesRef.current.size > 2) return
    } else if (touchesRef.current.size > 0) {
      touchesRef.current.clear()
    }
    const target = event.target as HTMLElement
    if (target.closest('textarea, input, a, button')) return
    containerRef.current?.focus({ preventScroll: true })

    const nodeElement = target.closest<HTMLElement>('[data-node-id]')
    const connectElement = target.closest<HTMLElement>('[data-connect]')
    const handleElement = target.closest<HTMLElement>('[data-handle]')
    const edgeElement = target.closest<HTMLElement>('[data-edge-id]')

    if (event.button === 1 || spaceRef.current || (isMobile && !nodeElement && !edgeElement)) {
      event.preventDefault()
      startPan(event)
      return
    }

    if (canEdit && connectElement) {
      startConnect(connectElement.dataset.nodeId!, connectElement.dataset.connect as CanvasSide)
      return
    }
    if (canEdit && handleElement) {
      startResize(event, handleElement.dataset.nodeId!, handleElement.dataset.handle!)
      return
    }

    if (nodeElement) {
      const id = nodeElement.dataset.nodeId!
      setEdgeSelection(null)
      const additive = event.shiftKey
      let next: string[]
      if (additive) {
        next = selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]
      } else {
        next = selection.includes(id) ? selection : [id]
      }
      setSelection(next)
      if (canEdit) ycanvas.bringToFront([id])
      if (!canEdit || event.button !== 0) return
      let ids = expandGroups(next)
      if (event.altKey) {
        ids = duplicate(ids)
        setSelection(ids)
      }
      if (ids.length > 0) startMove(event, ids, ids.includes(id) ? id : ids[0])
      return
    }

    if (edgeElement) {
      setEdgeSelection(edgeElement.dataset.edgeId!)
      setSelection([])
      return
    }

    if (!event.shiftKey) selectOnly(null)
    if (isMobile) return
    startMarquee(event, event.shiftKey)
  }

  useEffect(() => {
    const release = (event: PointerEvent) => {
      touchesRef.current.delete(event.pointerId)
      if (touchesRef.current.size === 0) pinchingRef.current = false
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement
    const nodeElement = target.closest<HTMLElement>('[data-node-id]')
    const edgeElement = target.closest<HTMLElement>('[data-edge-id]')
    if (nodeElement) {
      setMenu({ kind: 'card', id: nodeElement.dataset.nodeId!, x: event.clientX, y: event.clientY })
      return
    }
    if (edgeElement) {
      setMenu({ kind: 'edge', id: edgeElement.dataset.edgeId!, x: event.clientX, y: event.clientY })
      return
    }
    setMenu({ kind: 'canvas', x: event.clientX, y: event.clientY })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = event.metaKey || event.ctrlKey
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) ycanvas.redoStep()
      else ycanvas.undoStep()
      return
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      ycanvas.redoStep()
      return
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelection(canvas.nodes.map((node) => node.id))
      setEdgeSelection(null)
      return
    }
    if (meta && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      const created = duplicate(selection)
      if (created.length > 0) setSelection(created)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelection()
      return
    }
    if (event.key === 'Escape') {
      setSelection([])
      setEdgeSelection(null)
      setEditingId(null)
      setEditingLabelId(null)
      setEdgeLabel(null)
      setMenu(null)
      return
    }
    if (event.shiftKey && event.code === 'Digit1') {
      event.preventDefault()
      zoomToFit()
      return
    }
    if (event.shiftKey && event.code === 'Digit2') {
      event.preventDefault()
      zoomToSelection()
      return
    }
    const arrows: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const step = arrows[event.key]
    if (step && selection.length > 0 && canEdit) {
      event.preventDefault()
      const amount = event.shiftKey ? 10 : 1
      ycanvas.updateNodes(
        selection
          .map((id) => nodesById.get(id))
          .filter((node): node is CanvasNode => !!node)
          .map((node) => ({
            id: node.id,
            patch: { x: node.x + step.x * amount, y: node.y + step.y * amount },
          }))
      )
    }
  }

  // ---------- menus ----------

  const addTextCard = useCallback(
    (clientX?: number, clientY?: number) => {
      if (!canEdit) return
      if (canvas.nodes.length >= MAX_CANVAS_NODES) return
      const box = containerRef.current?.getBoundingClientRect()
      const point =
        clientX !== undefined && clientY !== undefined
          ? toWorld(clientX, clientY)
          : toWorld((box?.left ?? 0) + size.width / 2, (box?.top ?? 0) + size.height / 2)
      const node = textNode(
        Math.round(point.x - DEFAULT_TEXT_SIZE.width / 2),
        Math.round(point.y - DEFAULT_TEXT_SIZE.height / 2)
      )
      ycanvas.addNodes([node])
      setSelection([node.id])
      setEditingId(node.id)
    },
    [canEdit, canvas.nodes.length, size.height, size.width, toWorld, ycanvas]
  )

  const addGroup = useCallback(() => {
    if (!canEdit || canvas.nodes.length >= MAX_CANVAS_NODES) return
    const box = containerRef.current?.getBoundingClientRect()
    const center = toWorld((box?.left ?? 0) + size.width / 2, (box?.top ?? 0) + size.height / 2)
    const node: CanvasNode = {
      id: newNodeId(),
      type: 'group',
      x: Math.round(center.x - DEFAULT_GROUP_SIZE.width / 2),
      y: Math.round(center.y - DEFAULT_GROUP_SIZE.height / 2),
      width: DEFAULT_GROUP_SIZE.width,
      height: DEFAULT_GROUP_SIZE.height,
      text: '',
      label: t('canvas.menu.group'),
    }
    ycanvas.addNodes([node])
    setSelection([node.id])
  }, [canEdit, canvas.nodes.length, size.height, size.width, toWorld, ycanvas, t])

  const menuItems = useMemo((): {
    items: MenuItem[]
    close: () => void
    title?: string
    searchable?: boolean
    searchPlaceholder?: string
  } | null => {
    if (!menu) return null
    const close = () => setMenu(null)

    if (menu.kind === 'color') {
      const current = nodesById.get(menu.ids[0])?.color
      const items: MenuItem[] = CANVAS_PRESETS.map((preset) => ({
        label: t(COLOUR_LABELS[preset.id] ?? 'canvas.colour.other'),
        icon: <span className="canvas-swatch" style={{ background: `var(--canvas-preset-${preset.id})` }} />,
        checked: current === preset.id,
        keepOpen: true,
        onSelect: () => ycanvas.updateNodes(menu.ids.map((id) => ({ id, patch: { color: preset.id } }))),
      }))
      items.push({
        label: t('canvas.menu.noColour'),
        icon: <span className="canvas-swatch canvas-swatch--none" />,
        separatorBefore: true,
        checked: !current,
        keepOpen: true,
        onSelect: () => ycanvas.updateNodes(menu.ids.map((id) => ({ id, patch: { color: undefined } }))),
      })
      return { items, close, title: t('canvas.menu.colour') }
    }

    if (menu.kind === 'settings') {
      return {
        items: [
          {
            label: t('canvas.menu.snap'),
            icon: <Grid2x2 size={14} />,
            checked: snapGrid,
            keepOpen: true,
            onSelect: () => setSnapGrid((value) => !value),
          },
          {
            label: t('canvas.menu.readOnly'),
            icon: readOnly ? <EyeOff size={14} /> : <Eye size={14} />,
            checked: readOnly,
            keepOpen: true,
            onSelect: () => setReadOnly((value) => !value),
          },
          {
            label: t('canvas.menu.fit'),
            icon: <Maximize2 size={14} />,
            separatorBefore: true,
            onSelect: zoomToFit,
          },
        ],
        close,
        title: t('canvas.menu.settings'),
      }
    }

    if (menu.kind === 'files') {
      if (filesByTitle.length === 0) {
        return {
          items: [
            {
              label: t('canvas.menu.noNotes'),
              icon: <FileText size={14} />,
              disabled: true,
              disabledReason: t('canvas.menu.noNotesHint'),
              onSelect: () => undefined,
            },
          ],
          close,
          title: t('canvas.menu.addNoteTitle'),
        }
      }
      return {
        items: filesByTitle.slice(0, 200).map((file) => ({
          label: file.title || file.path,
          icon: <FileText size={14} />,
          onSelect: () => {
            const box = containerRef.current?.getBoundingClientRect()
            const center = toWorld((box?.left ?? 0) + size.width / 2, (box?.top ?? 0) + size.height / 2)
            const node: CanvasNode = {
              id: newNodeId(),
              type: 'file',
              x: Math.round(center.x),
              y: Math.round(center.y),
              width: 300,
              height: 120,
              file: file.path,
            }
            ycanvas.addNodes([node])
            setSelection([node.id])
          },
        })),
        close,
        title: t('canvas.menu.addNoteTitle'),
        searchable: true,
        searchPlaceholder: t('canvas.menu.searchNote'),
      }
    }

    if (menu.kind === 'edge') {
      const edge = canvas.edges.find((item) => item.id === menu.id)
      if (!edge) return null
      const noDirection = edge.fromEnd === 'none' && edge.toEnd === 'none'
      const oneWay = edge.fromEnd === 'none' && edge.toEnd === 'arrow'
      const bothWays = edge.fromEnd === 'arrow' && edge.toEnd === 'arrow'
      return {
        items: [
          {
            label: t('canvas.menu.edgeLabel'),
            icon: <Type size={14} />,
            onSelect: () =>
              setEdgeLabel({ id: edge.id, value: edge.label ?? '' }),
          },
          {
            label: t('canvas.menu.noDirection'),
            icon: <Minus size={14} />,
            separatorBefore: true,
            checked: noDirection,
            keepOpen: true,
            onSelect: () => ycanvas.updateEdge(edge.id, { fromEnd: 'none', toEnd: 'none' }),
          },
          {
            label: t('canvas.menu.oneWay'),
            icon: <ArrowRight size={14} />,
            checked: oneWay,
            keepOpen: true,
            onSelect: () => ycanvas.updateEdge(edge.id, { fromEnd: 'none', toEnd: 'arrow' }),
          },
          {
            label: t('canvas.menu.bothWays'),
            icon: <ArrowLeftRight size={14} />,
            checked: bothWays,
            keepOpen: true,
            onSelect: () => ycanvas.updateEdge(edge.id, { fromEnd: 'arrow', toEnd: 'arrow' }),
          },
          {
            label: t('canvas.menu.removeEdge'),
            icon: <Trash2 size={14} />,
            danger: true,
            separatorBefore: true,
            onSelect: () => {
              ycanvas.removeEdges([edge.id])
              setEdgeSelection(null)
            },
          },
        ],
        close,
        title: edge.label || t('canvas.menu.edgeTitle'),
      }
    }

    if (menu.kind === 'card') {
      const node = nodesById.get(menu.id)
      if (!node) return null
      const items: MenuItem[] = []
      if (node.type === 'text' && canEdit) {
        items.push({
          label: t('canvas.menu.edit'),
          icon: <Pencil size={14} />,
          onSelect: () => setEditingId(node.id),
        })
      }
      if (node.type === 'group' && canEdit) {
        items.push({
          label: t('canvas.menu.renameGroup'),
          icon: <Pencil size={14} />,
          onSelect: () => setEditingLabelId(node.id),
        })
      }
      if (node.type === 'file') {
        const resolved = node.file ? resolveCanvasFile(files, node.file) : null
        if (resolved) {
          items.push({
            label: t('canvas.menu.openNote'),
            icon: <FileText size={14} />,
            separatorBefore: true,
            onSelect: () => onOpenNote(resolved.id),
          })
        }
      }
      if (node.type === 'link' && node.url) {
        items.push({
          label: t('canvas.menu.openLink'),
          icon: <ExternalLink size={14} />,
          onSelect: () => window.open(node.url, '_blank', 'noopener'),
        })
      }
      if (canEdit) {
        items.push({
          label: t('canvas.menu.duplicate'),
          icon: <Copy size={14} />,
          separatorBefore: true,
          onSelect: () => setSelection(duplicate([node.id])),
        })
        items.push({
          label: t('canvas.menu.colour'),
          icon: <span className="canvas-swatch" style={node.color ? { background: `var(--canvas-preset-${node.color})` } : undefined} />,
          onSelect: () => setMenu({ kind: 'color', ids: [node.id], x: menu.x + 140, y: menu.y }),
        })
        items.push({
          label: t('canvas.menu.delete'),
          icon: <Trash2 size={14} />,
          danger: true,
          separatorBefore: true,
          onSelect: () => {
            ycanvas.removeNodes([node.id])
            setSelection([])
          },
        })
      }
      return {
        items,
        close,
        title: node.type === 'group' ? node.label || t('canvas.menu.group') : t('canvas.menu.card'),
      }
    }

    // Canvas background.
    return {
      items: [
        {
          label: t('canvas.menu.newCard'),
          icon: <Type size={14} />,
          onSelect: () => addTextCard(menu.x, menu.y),
        },
        {
          label: t('canvas.menu.newGroup'),
          icon: <SquareDashed size={14} />,
          onSelect: addGroup,
        },
        {
          label: t('canvas.menu.addNote'),
          icon: <FileText size={14} />,
          onSelect: () => setMenu({ kind: 'files', x: menu.x, y: menu.y }),
        },
        {
          label: t('canvas.menu.settings'),
          icon: <Settings2 size={14} />,
          separatorBefore: true,
          onSelect: () => setMenu({ kind: 'settings', x: menu.x, y: menu.y }),
        },
      ],
      close,
      title: t('canvas.menu.canvas'),
    }
  }, [
    addGroup,
    addTextCard,
    canEdit,
    canvas.edges,
    duplicate,
    files,
    filesByTitle,
    menu,
    nodesById,
    onOpenNote,
    readOnly,
    size.height,
    size.width,
    snapGrid,
    t,
    toWorld,
    ycanvas,
    zoomToFit,
  ])

  // ---------- paints ----------

  const selectionBounds = useMemo(() => {
    const chosen = canvas.nodes.filter((node) => selection.includes(node.id))
    return unionRect(chosen.map((node) => rects.get(node.id) ?? rectOf(node)))
  }, [canvas.nodes, rects, selection])

  const selectedEdge = edgeSelection ? canvas.edges.find((edge) => edge.id === edgeSelection) ?? null : null

  return (
    <div
      ref={containerRef}
      className={`canvas-surface${spaceRef.current ? ' is-panning-tool' : ''}`}
      style={{
        backgroundSize: `${20 * currentView.zoom}px ${20 * currentView.zoom}px`,
        backgroundPosition: `${currentView.x}px ${currentView.y}px`,
      }}
      role="application"
      aria-label={t('canvas.surfaceLabel')}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate3d(${currentView.x}px, ${currentView.y}px, 0) scale(${currentView.zoom})`,
        }}
      >
        <svg className="canvas-edges" aria-hidden="true">
          {edges.map(({ edge, geometry }) => {
            const selected = edgeSelection === edge.id
            return (
              <g key={edge.id} className={`canvas-edge${selected ? ' is-selected' : ''}`}>
                <path className="canvas-edge-hit" d={geometry.path} data-edge-id={edge.id} />
                <path
                  className="canvas-edge-line"
                  d={geometry.path}
                  style={edge.color ? { stroke: canvasColor(edge.color) } : undefined}
                />
                {edge.toEnd !== 'none' && (
                  <polygon
                    className="canvas-edge-arrow"
                    points={arrowPolygon(geometry.end, geometry.c2)}
                    style={edge.color ? { fill: canvasColor(edge.color) } : undefined}
                  />
                )}
                {edge.fromEnd === 'arrow' && (
                  <polygon
                    className="canvas-edge-arrow"
                    points={arrowPolygon(geometry.start, geometry.c1)}
                    style={edge.color ? { fill: canvasColor(edge.color) } : undefined}
                  />
                )}
                {edge.label && (
                  <text
                    className="canvas-edge-label"
                    x={bezierMidpoint(geometry.start, geometry.c1, geometry.c2, geometry.end).x}
                    y={bezierMidpoint(geometry.start, geometry.c1, geometry.c2, geometry.end).y}
                    data-edge-id={edge.id}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            )
          })}
          {connecting && (() => {
            const from = rects.get(connecting.from)
            if (!from) return null
            const target = connecting.target ? rects.get(connecting.target) : null
            const to = target ?? { x: connecting.point.x, y: connecting.point.y, width: 1, height: 1 }
            const geometry = edgeGeometry(from, to, connecting.side, target ? undefined : 'left')
            return (
              <g className="canvas-edge canvas-edge--drawing">
                <path className="canvas-edge-line" d={geometry.path} />
                <circle cx={connecting.point.x} cy={connecting.point.y} r={4} className="canvas-edge-dot" />
              </g>
            )
          })()}
        </svg>

        {canvas.nodes.map((node) => {
          const rect = rects.get(node.id) ?? rectOf(node)
          const resolved =
            node.type === 'file' && node.file ? resolveCanvasFile(files, node.file) : null
          return (
            <MemoCard
              key={node.id}
              node={node}
              rect={rect}
              text={node.type === 'text' ? ycanvas.textOf(node.id) : ''}
              selected={selection.includes(node.id)}
              editing={editingId === node.id}
              editingLabel={editingLabelId === node.id}
              editable={canEdit}
              resolved={resolved}
              onCommitText={(text) => {
                ycanvas.setText(node.id, text)
                setEditingId(null)
              }}
              onCommitLabel={(label) => {
                ycanvas.updateNodes([{ id: node.id, patch: { label } }])
                setEditingLabelId(null)
              }}
              onStartEdit={() => setEditingId(node.id)}
              onStartEditLabel={() => setEditingLabelId(node.id)}
              onOpenFile={() => {
                if (resolved) onOpenNote(resolved.id)
              }}
            />
          )
        })}

        {selection.length > 0 &&
          selection.map((id) => {
            const rect = rects.get(id)
            if (!rect || id === editingId) return null
            return (
              <div
                key={`handles-${id}`}
                className="canvas-handles"
                style={{
                  transform: `translate(${rect.x}px, ${rect.y}px)`,
                  width: rect.width,
                  height: rect.height,
                }}
              >
                {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => (
                  <span
                    key={handle}
                    className={`canvas-handle canvas-handle--${handle}`}
                    data-node-id={id}
                    data-handle={handle}
                  />
                ))}
                {['top', 'right', 'bottom', 'left'].map((side) => (
                  <span
                    key={side}
                    className={`canvas-connect canvas-connect--${side}`}
                    data-node-id={id}
                    data-connect={side}
                    title={t('canvas.dragToConnect')}
                  />
                ))}
              </div>
            )
          })}

        {marquee && (
          <div
            className="canvas-marquee"
            style={{
              transform: `translate(${marquee.x}px, ${marquee.y}px)`,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
      </div>

      {selection.length > 0 && selectionBounds && (
        <div
          className="canvas-selection-bar"
          style={{
            left: Math.max(8, selectionBounds.x * currentView.zoom + currentView.x),
            top: Math.max(8, selectionBounds.y * currentView.zoom + currentView.y - 44),
          }}
        >
          {selection.length === 1 && nodesById.get(selection[0])?.type === 'text' && canEdit && (
            <button className="icon-btn icon-btn--sm" title={t('canvas.edit')} onClick={() => setEditingId(selection[0])}>
              <Type size={13} />
            </button>
          )}
          {canEdit && (
            <>
              <button
                className="icon-btn icon-btn--sm"
                title={t('canvas.menu.colour')}
                aria-haspopup="menu"
                onClick={(event) => {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                  setMenu({ kind: 'color', ids: selection, x: rect.left, y: rect.bottom + 4 })
                }}
              >
                <Palette size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.menu.duplicate')} onClick={() => setSelection(duplicate(selection))}>
                <Copy size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.delete')} onClick={deleteSelection}>
                <Trash2 size={13} />
              </button>
            </>
          )}
          {selection.length > 1 && canEdit && (
            <>
              <span className="canvas-bar-sep" />
              <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.alignLeft')} onClick={() => runAlign('left')}>
                <AlignLeft size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.centre')} onClick={() => runAlign('center')}>
                <AlignCenter size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.alignRight')} onClick={() => runAlign('right')}>
                <AlignRight size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.alignTop')} onClick={() => runAlign('top')}>
                <AlignStartVertical size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.centreVertical')} onClick={() => runAlign('middle')}>
                <AlignCenterVertical size={13} />
              </button>
              <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.alignBottom')} onClick={() => runAlign('bottom')}>
                <AlignEndVertical size={13} />
              </button>
            </>
          )}
          <button className="icon-btn icon-btn--sm" title={t('canvas.toolbar.zoomToSelection')} onClick={zoomToSelection}>
            <ZoomIn size={13} />
          </button>
        </div>
      )}

      {selectedEdge && (
        <div
          className="canvas-selection-bar"
          style={{
            left: Math.max(
              8,
              Math.min(
                size.width - 180,
                (() => {
                  const from = rects.get(selectedEdge.fromNode)
                  const to = rects.get(selectedEdge.toNode)
                  if (!from || !to) return 8
                  const geometry = edgeGeometry(from, to, selectedEdge.fromSide, selectedEdge.toSide)
                  return (
                    bezierMidpoint(geometry.start, geometry.c1, geometry.c2, geometry.end).x *
                      currentView.zoom +
                    currentView.x
                  )
                })()
              )
            ),
            top: 8,
          }}
        >
          <button
            className="icon-btn icon-btn--sm"
            title={t('canvas.toolbar.label')}
            onClick={() => setEdgeLabel({ id: selectedEdge.id, value: selectedEdge.label ?? '' })}
          >
            <Type size={13} />
          </button>
          <button
            className="icon-btn icon-btn--sm"
            title={t('canvas.toolbar.direction')}
            onClick={() =>
              ycanvas.updateEdge(selectedEdge.id, {
                fromEnd: selectedEdge.fromEnd === 'arrow' ? 'none' : 'arrow',
              })
            }
          >
            <ArrowLeftRight size={13} />
          </button>
          <button
            className="icon-btn icon-btn--sm"
            title={t('canvas.toolbar.deleteEdge')}
            onClick={() => {
              ycanvas.removeEdges([selectedEdge.id])
              setEdgeSelection(null)
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {edgeLabel && (
        <input
          className="canvas-edge-label-input"
          autoFocus
          value={edgeLabel.value}
          placeholder={t('canvas.toolbar.edgeLabel')}
          onChange={(event) => setEdgeLabel({ id: edgeLabel.id, value: event.target.value })}
          onBlur={() => {
            ycanvas.updateEdge(edgeLabel.id, { label: edgeLabel.value.trim() || undefined })
            setEdgeLabel(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              ycanvas.updateEdge(edgeLabel.id, { label: edgeLabel.value.trim() || undefined })
              setEdgeLabel(null)
            }
            event.stopPropagation()
          }}
        />
      )}

      {canvas.nodes.length === 0 && (
        <div className="canvas-empty">
          <p className="empty-title">{t('canvas.emptyTitle')}</p>
          <p className="hint">{t('canvas.emptyHint')}</p>
        </div>
      )}

      <div className="canvas-zoom">
        <button className="icon-btn icon-btn--sm" title={t('canvas.zoomIn')} onClick={() => zoomBy(1.25)}>
          <Plus size={14} />
        </button>
        <button className="icon-btn icon-btn--sm" title={t('canvas.zoomOut')} onClick={() => zoomBy(0.8)}>
          <Minus size={14} />
        </button>
        <button className="icon-btn icon-btn--sm" title={t('canvas.fitToScreen')} onClick={zoomToFit}>
          <Maximize2 size={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          title={t('canvas.settings')}
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ kind: 'settings', x: rect.left, y: rect.bottom + 4 })
          }}
        >
          <Settings2 size={14} />
        </button>
        <span className="canvas-zoom-value">{Math.round(currentView.zoom * 100)}%</span>
      </div>

      <div className="canvas-actions">
        <button className="canvas-action" title={t('canvas.newCard')} disabled={!canEdit} onClick={() => addTextCard()}>
          <Type size={15} />
          Tarjeta
        </button>
        <button
          className="canvas-action"
          title={t('canvas.addNote')}
          aria-haspopup="menu"
          disabled={!canEdit}
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ kind: 'files', x: rect.left, y: rect.top - 8 })
          }}
        >
          <FileText size={15} />
          Nota
        </button>
        <button className="canvas-action" title={t('canvas.newGroup')} disabled={!canEdit} onClick={addGroup}>
          <Square size={15} />
          Grupo
        </button>
      </div>

      {menu && menuItems && (
        <Menu
          items={menuItems.items}
          title={menuItems.title}
          searchable={menuItems.searchable}
          searchPlaceholder={menuItems.searchPlaceholder}
          pos={{ x: menu.x, y: menu.y }}
          anchor="pointer"
          onClose={menuItems.close}
        />
      )}
    </div>
  )
}
