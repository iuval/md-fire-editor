/**
 * JSON Canvas ⇄ Y.Doc.
 *
 * The transport (`FirestoreYjsProvider`) is content-agnostic, so a canvas gets
 * collaboration by choosing a document shape:
 *
 *   canvas            Y.Map
 *   ├── nodes         Y.Map<id, Y.Map>   fields + `z` (array order is z-index)
 *   │     └── text    Y.Text             only text cards: concurrent typing merges
 *   └── edges         Y.Map<id, Y.Map>
 *
 * Positions and labels are last-writer-wins per field, like any editor that
 * stores numbers; card text is a real CRDT so two people in the same card do
 * not lose words.
 *
 * Every local mutation runs in one transaction with `LOCAL_ORIGIN`, which is
 * what `Y.UndoManager` tracks: remote blocks (applied by the provider with its
 * own origin) are never undone by this user's Ctrl+Z.
 */
import * as Y from 'yjs'
import {
  parseCanvas,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
} from './model'

export const LOCAL_ORIGIN = 'canvas-local'

const NODE_FIELDS = [
  'type', 'x', 'y', 'width', 'height', 'color',
  'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle',
] as const

function isNodeMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map
}

function readText(node: Y.Map<unknown>): string {
  const value = node.get('text')
  if (value instanceof Y.Text) return value.toString()
  return typeof value === 'string' ? value : ''
}

/** Minimal single-span edit: what turning `before` into `after` actually needs. */
export function minimalTextDiff(
  before: string,
  after: string
): { index: number; remove: number; insert: string } {
  if (before === after) return { index: 0, remove: 0, insert: '' }
  let start = 0
  const limit = Math.min(before.length, after.length)
  while (start < limit && before[start] === after[start]) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--
    endAfter--
  }
  return { index: start, remove: endBefore - start, insert: after.slice(start, endAfter) }
}

export class YCanvas {
  readonly doc: Y.Doc
  readonly nodes: Y.Map<Y.Map<unknown>>
  readonly edges: Y.Map<Y.Map<unknown>>
  readonly undo: Y.UndoManager
  private listeners = new Set<() => void>()
  /** Bumped on every change so React's `useSyncExternalStore` re-renders. */
  private version = 0

  constructor(doc: Y.Doc) {
    this.doc = doc
    // Two root-level maps, not `canvas.nodes`/`canvas.edges`: a structural
    // default created independently by two clients is a map-key conflict, and
    // one of them would end up reading a map nobody writes to (cards vanish on
    // the second device). Root maps always exist as stable shared types.
    this.nodes = doc.getMap<Y.Map<unknown>>('canvas:nodes')
    this.edges = doc.getMap<Y.Map<unknown>>('canvas:edges')
    this.undo = new Y.UndoManager([this.nodes, this.edges], {
      captureTimeout: 400,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    })
    this.nodes.observeDeep(this.changed)
    this.edges.observeDeep(this.changed)
  }

  private changed = () => {
    this.version++
    for (const listener of this.listeners) listener()
  }

  getVersion = (): number => this.version

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** No cards yet: the first view may seed it from the note body. */
  isEmpty(): boolean {
    return this.nodes.size === 0 && this.edges.size === 0
  }

  private transact(fn: () => void, origin: unknown = LOCAL_ORIGIN): void {
    this.doc.transact(fn, origin)
  }

  // ---------- reading ----------

  private nodeToJSON(id: string, node: Y.Map<unknown>): CanvasNode {
    const fields: Record<string, unknown> = {}
    for (const field of NODE_FIELDS) {
      const value = node.get(field)
      if (value !== undefined) fields[field] = value
    }
    const extra = node.get('$extra')
    const result: CanvasNode = {
      id,
      type: typeof fields.type === 'string' ? fields.type : 'text',
      x: Number(fields.x) || 0,
      y: Number(fields.y) || 0,
      width: Math.max(1, Number(fields.width) || 1),
      height: Math.max(1, Number(fields.height) || 1),
    }
    if (typeof fields.text === 'undefined' && node.get('text') instanceof Y.Text) {
      result.text = readText(node)
    } else if (typeof fields.text === 'string') {
      result.text = fields.text
    }
    const writable = result as unknown as Record<string, unknown>
    for (const key of ['file', 'subpath', 'url', 'label', 'background', 'backgroundStyle', 'color']) {
      if (typeof fields[key] === 'string') writable[key] = fields[key]
    }
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      result.$extra = { ...(extra as Record<string, unknown>) }
    }
    return result
  }

  private edgeToJSON(id: string, edge: Y.Map<unknown>): CanvasEdge {
    const extra = edge.get('$extra')
    const result: CanvasEdge = {
      id,
      fromNode: String(edge.get('fromNode') ?? ''),
      toNode: String(edge.get('toNode') ?? ''),
    }
    const writable = result as unknown as Record<string, unknown>
    for (const key of ['fromSide', 'toSide', 'fromEnd', 'toEnd', 'color', 'label']) {
      const value = edge.get(key)
      if (typeof value === 'string') writable[key] = value
    }
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      result.$extra = { ...(extra as Record<string, unknown>) }
    }
    return result
  }

  private zOf(id: string): number {
    const z = this.nodes.get(id)?.get('z')
    return typeof z === 'number' ? z : 0
  }

  /** The canvas as the file sees it: array order is z-order. */
  toJSON(): CanvasDoc {
    const nodes: CanvasNode[] = []
    for (const [id, node] of this.nodes) {
      if (!isNodeMap(node)) continue
      nodes.push(this.nodeToJSON(id, node))
    }
    nodes.sort((a, b) => this.zOf(a.id) - this.zOf(b.id) || a.id.localeCompare(b.id))

    const edges: CanvasEdge[] = []
    for (const [id, edge] of this.edges) {
      if (!isNodeMap(edge)) continue
      edges.push(this.edgeToJSON(id, edge))
    }
    edges.sort((a, b) => a.id.localeCompare(b.id))
    return { nodes, edges }
  }

  node(id: string): CanvasNode | null {
    const node = this.nodes.get(id)
    return node && isNodeMap(node) ? this.nodeToJSON(id, node) : null
  }

  textOf(id: string): string {
    const node = this.nodes.get(id)
    return node && isNodeMap(node) ? readText(node) : ''
  }

  // ---------- seeding and external writes ----------

  /**
   * First load: the note body becomes the document. Returns false when the
   * document already holds cards (a second view must not seed again).
   */
  seed(canvas: CanvasDoc): boolean {
    if (!this.isEmpty()) return false
    // Seeding is not an undoable user action: Ctrl+Z on a freshly opened canvas
    // must not delete every card.
    this.transact(() => this.mergeInto(canvas), 'canvas-seed')
    return true
  }

  seedFromText(text: string): boolean {
    if (!text.trim()) return false
    let parsed: CanvasDoc
    try {
      parsed = parseCanvas(text).canvas
    } catch {
      return false
    }
    return this.seed(parsed)
  }

  /**
   * An external write (the agent CLI, a vault import, another device) arrives
   * through the note body. Merge by id instead of clearing the document: cards
   * the payload does not mention are deleted only when the payload is a
   * complete canvas, which it always is — but fields it does not set are left
   * alone, so unrelated local work is not thrown away.
   */
  applyExternal(canvas: CanvasDoc): void {
    this.transact(() => this.mergeInto(canvas), 'canvas-remote')
  }

  private mergeInto(canvas: CanvasDoc): void {
    const seenNodes = new Set<string>()
    canvas.nodes.forEach((node, index) => {
      seenNodes.add(node.id)
      this.writeNode(node, index)
    })
    for (const id of Array.from(this.nodes.keys())) {
      if (!seenNodes.has(id)) this.nodes.delete(id)
    }

    const seenEdges = new Set<string>()
    for (const edge of canvas.edges) {
      seenEdges.add(edge.id)
      this.writeEdge(edge)
    }
    for (const id of Array.from(this.edges.keys())) {
      if (!seenEdges.has(id)) this.edges.delete(id)
    }
  }

  private writeNode(node: CanvasNode, z: number): void {
    let target = this.nodes.get(node.id)
    if (!target || !isNodeMap(target)) {
      target = new Y.Map<unknown>()
      this.nodes.set(node.id, target)
    }
    const set = (key: string, value: unknown) => {
      if (value === undefined) {
        if (target!.has(key)) target!.delete(key)
        return
      }
      if (target!.get(key) !== value) target!.set(key, value)
    }
    set('type', node.type)
    set('x', node.x)
    set('y', node.y)
    set('width', node.width)
    set('height', node.height)
    set('color', node.color)
    set('file', node.file)
    set('subpath', node.subpath)
    set('url', node.url)
    set('label', node.label)
    set('background', node.background)
    set('backgroundStyle', node.backgroundStyle)
    set('$extra', node.$extra)
    set('z', z)

    if (node.text !== undefined) {
      const current = target.get('text')
      if (current instanceof Y.Text) {
        const before = current.toString()
        if (before !== node.text) {
          const diff = minimalTextDiff(before, node.text)
          current.delete(diff.index, diff.remove)
          if (diff.insert) current.insert(diff.index, diff.insert)
        }
      } else {
        const text = new Y.Text()
        text.insert(0, node.text)
        target.set('text', text)
      }
    } else if (target.has('text')) {
      target.delete('text')
    }
  }

  private writeEdge(edge: CanvasEdge): void {
    let target = this.edges.get(edge.id)
    if (!target || !isNodeMap(target)) {
      target = new Y.Map<unknown>()
      this.edges.set(edge.id, target)
    }
    const set = (key: string, value: unknown) => {
      if (value === undefined) {
        if (target!.has(key)) target!.delete(key)
        return
      }
      if (target!.get(key) !== value) target!.set(key, value)
    }
    set('fromNode', edge.fromNode)
    set('toNode', edge.toNode)
    set('fromSide', edge.fromSide)
    set('toSide', edge.toSide)
    set('fromEnd', edge.fromEnd)
    set('toEnd', edge.toEnd)
    set('color', edge.color)
    set('label', edge.label)
    set('$extra', edge.$extra)
  }

  // ---------- local editing ----------

  private maxZ(): number {
    let max = 0
    for (const id of this.nodes.keys()) max = Math.max(max, this.zOf(id))
    return max
  }

  addNode(node: CanvasNode): void {
    this.addNodes([node])
  }

  /** Cards and their connections in one transaction: one undo step, one block. */
  addNodes(nodes: CanvasNode[], edges: CanvasEdge[] = []): void {
    if (nodes.length === 0 && edges.length === 0) return
    this.transact(() => {
      let z = this.maxZ()
      for (const node of nodes) this.writeNode(node, ++z)
      for (const edge of edges) this.writeEdge(edge)
    })
  }

  /** Commits a batch of field patches (drag, resize, color) as one undo step. */
  updateNodes(patches: { id: string; patch: Partial<CanvasNode> }[]): void {
    if (patches.length === 0) return
    this.transact(() => {
      for (const { id, patch } of patches) {
        const node = this.nodes.get(id)
        if (!node || !isNodeMap(node)) continue
        for (const key of Object.keys(patch) as (keyof CanvasNode)[]) {
          if (key === 'id' || key === 'text' || key === '$extra') continue
          const value = patch[key]
          if (value === undefined) {
            if (node.has(key as string)) node.delete(key as string)
          } else if (node.get(key as string) !== value) {
            node.set(key as string, value)
          }
        }
      }
    })
  }

  /**
   * Text of one card. The inline editor calls this on commit with the whole
   * string; it becomes one minimal insert/delete on the Y.Text, so two people
   * editing different sentences of the same card keep both.
   */
  setText(id: string, text: string): void {
    const node = this.nodes.get(id)
    if (!node || !isNodeMap(node)) return
    this.transact(() => {
      const current = node.get('text')
      if (!(current instanceof Y.Text)) {
        const created = new Y.Text()
        created.insert(0, text)
        node.set('text', created)
        return
      }
      const before = current.toString()
      if (before === text) return
      const diff = minimalTextDiff(before, text)
      current.delete(diff.index, diff.remove)
      if (diff.insert) current.insert(diff.index, diff.insert)
    })
  }

  /** Obsidian brings a selected card to the front; z is what the array order is. */
  bringToFront(ids: string[]): void {
    if (ids.length === 0) return
    this.transact(() => {
      let z = this.maxZ()
      for (const id of ids) {
        const node = this.nodes.get(id)
        if (node && isNodeMap(node)) node.set('z', ++z)
      }
    })
  }

  addEdge(edge: CanvasEdge): void {
    this.transact(() => this.writeEdge(edge))
  }

  updateEdge(id: string, patch: Partial<CanvasEdge>): void {
    this.transact(() => {
      const edge = this.edges.get(id)
      if (!edge || !isNodeMap(edge)) return
      for (const key of Object.keys(patch) as (keyof CanvasEdge)[]) {
        const value = patch[key]
        if (value === undefined) {
          if (edge.has(key as string)) edge.delete(key as string)
        } else if (edge.get(key as string) !== value) {
          edge.set(key as string, value)
        }
      }
    })
  }

  /**
   * Deletes cards and every connection that touched them: an edge to a card
   * that no longer exists makes the file invalid for Obsidian.
   */
  removeNodes(ids: string[]): void {
    if (ids.length === 0) return
    const gone = new Set(ids)
    this.transact(() => {
      for (const id of ids) this.nodes.delete(id)
      for (const [edgeId, edge] of this.edges) {
        if (!isNodeMap(edge)) continue
        const from = edge.get('fromNode')
        const to = edge.get('toNode')
        if (gone.has(String(from)) || gone.has(String(to))) this.edges.delete(edgeId)
      }
    })
  }

  removeEdges(ids: string[]): void {
    if (ids.length === 0) return
    this.transact(() => {
      for (const id of ids) this.edges.delete(id)
    })
  }

  /** Undo/redo, exposed for the toolbar buttons (the keyboard uses these too). */
  undoStep(): void {
    this.undo.undo()
  }

  redoStep(): void {
    this.undo.redo()
  }

  canUndo(): boolean {
    return this.undo.canUndo()
  }

  canRedo(): boolean {
    return this.undo.canRedo()
  }

  destroy(): void {
    this.nodes.unobserveDeep(this.changed)
    this.edges.unobserveDeep(this.changed)
    this.undo.destroy()
    this.listeners.clear()
  }
}
