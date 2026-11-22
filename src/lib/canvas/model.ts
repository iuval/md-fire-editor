/**
 * JSON Canvas 1.0, the format Obsidian writes for `.canvas` files.
 *
 * The file is the source of truth and must survive a round trip untouched:
 * Obsidian writes one single line with `", "` and `": "` separators
 * (`json.dumps(..., ensure_ascii=False)` style), keeps nodes in z-order and
 * writes each field in a fixed order. `serializeCanvas` reproduces that byte for
 * byte — verified against a real 29 KB canvas from a vault — because an import
 * that reformats the file is not a seamless import.
 *
 * Real files also go past the published spec: groups carry a `text` field, ids
 * are arbitrary strings (`dup2`, not only hex), and colors appear as `"7"` or
 * `"#ffffff"` next to the documented `"1".."6"` presets. Everything unknown is
 * kept in `$extra`, in file order, so saving never loses data.
 */

import { extractTags } from '../tags'

export const CANVAS_EXTENSION = '.canvas'

/** The rules allow 600.000 characters per body; a canvas must never be sliced. */
export const MAX_CANVAS_CHARS = 600_000
export const MAX_CANVAS_NODES = 1_000

export const DEFAULT_TEXT_SIZE = { width: 250, height: 60 }
export const DEFAULT_GROUP_SIZE = { width: 600, height: 400 }
export const DEFAULT_LINK_SIZE = { width: 400, height: 300 }

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'
export type CanvasEnd = 'none' | 'arrow'
export type CanvasBackgroundStyle = 'cover' | 'ratio' | 'repeat'
export type CanvasNodeType = 'text' | 'file' | 'link' | 'group'

/**
 * One card. `type` stays a string: a newer Obsidian may write a type this
 * version does not know and the card must still render instead of vanishing.
 */
export interface CanvasNode {
  id: string
  type: CanvasNodeType | (string & {})
  x: number
  y: number
  width: number
  height: number
  /** Text cards. Obsidian also writes an empty one on groups. */
  text?: string
  /** File cards: a vault path, exactly as Obsidian stores it. */
  file?: string
  /** File cards narrowed to a heading or block (`#heading`). */
  subpath?: string
  /** Link cards. */
  url?: string
  /** Group label. */
  label?: string
  background?: string
  backgroundStyle?: CanvasBackgroundStyle
  /** Preset `"1".."6"`, a hex string, or a preset this version does not know. */
  color?: string
  /** Unknown fields, kept in file order. */
  $extra?: Record<string, unknown>
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: CanvasSide
  fromEnd?: CanvasEnd
  toSide?: CanvasSide
  toEnd?: CanvasEnd
  color?: string
  label?: string
  $extra?: Record<string, unknown>
}

export interface CanvasDoc {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface ParseResult {
  canvas: CanvasDoc
  /** Nodes dropped for missing/invalid ids or coordinates. */
  dropped: number
  /** Ids that appeared twice and were suffixed (`dup2-2`) to stay addressable. */
  duplicates: number
}

const NODE_TYPES: ReadonlySet<string> = new Set(['text', 'file', 'link', 'group'])
const SIDES: ReadonlySet<string> = new Set(['top', 'right', 'bottom', 'left'])
const ENDS: ReadonlySet<string> = new Set(['none', 'arrow'])
const BACKGROUND_STYLES: ReadonlySet<string> = new Set(['cover', 'ratio', 'repeat'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Keys the typed model already owns; everything else is `$extra`. */
const NODE_KEYS = new Set([
  'id', 'type', 'x', 'y', 'width', 'height', 'text', 'file', 'subpath',
  'url', 'label', 'background', 'backgroundStyle', 'color',
])
const EDGE_KEYS = new Set([
  'id', 'fromNode', 'toNode', 'fromSide', 'fromEnd', 'toSide', 'toEnd', 'color', 'label',
])

function extras(source: Record<string, unknown>, known: Set<string>): Record<string, unknown> | undefined {
  let extra: Record<string, unknown> | undefined
  for (const key of Object.keys(source)) {
    if (known.has(key)) continue
    extra ??= {}
    extra[key] = source[key]
  }
  return extra
}

function parseNode(value: unknown, seen: Set<string>): { node: CanvasNode | null; duplicate: boolean } {
  if (!isRecord(value)) return { node: null, duplicate: false }
  const rawId = optionalText(value.id)?.trim()
  if (!rawId) return { node: null, duplicate: false }
  const type = optionalText(value.type)?.trim()
  if (!type) return { node: null, duplicate: false }

  let duplicate = false
  let id = rawId
  for (let n = 2; seen.has(id); n++) {
    id = `${rawId}-${n}`
    duplicate = true
  }
  seen.add(id)

  const node: CanvasNode = {
    id,
    // Unknown types are kept verbatim: a newer Obsidian must not lose a card.
    type: NODE_TYPES.has(type) ? (type as CanvasNodeType) : type,
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width: Math.max(1, finite(value.width, 1)),
    height: Math.max(1, finite(value.height, 1)),
  }
  const text = optionalText(value.text)
  if (text !== undefined) node.text = text
  const file = optionalText(value.file)
  if (file !== undefined) node.file = file
  const subpath = optionalText(value.subpath)
  if (subpath !== undefined) node.subpath = subpath
  const url = optionalText(value.url)
  if (url !== undefined) node.url = url
  const label = optionalText(value.label)
  if (label !== undefined) node.label = label
  const background = optionalText(value.background)
  if (background !== undefined) node.background = background
  const style = optionalText(value.backgroundStyle)
  if (style !== undefined) {
    node.backgroundStyle = BACKGROUND_STYLES.has(style)
      ? (style as CanvasBackgroundStyle)
      : (style as CanvasBackgroundStyle)
  }
  const color = optionalText(value.color)
  if (color !== undefined) node.color = color
  const nodeExtra = extras(value, NODE_KEYS)
  if (nodeExtra) node.$extra = nodeExtra
  return { node, duplicate }
}

function parseEdge(value: unknown, seen: Set<string>): { edge: CanvasEdge | null; duplicate: boolean } {
  if (!isRecord(value)) return { edge: null, duplicate: false }
  const rawId = optionalText(value.id)?.trim()
  const fromNode = optionalText(value.fromNode)?.trim()
  const toNode = optionalText(value.toNode)?.trim()
  if (!rawId || !fromNode || !toNode) return { edge: null, duplicate: false }

  let duplicate = false
  let id = rawId
  for (let n = 2; seen.has(id); n++) {
    id = `${rawId}-${n}`
    duplicate = true
  }
  seen.add(id)

  const edge: CanvasEdge = { id, fromNode, toNode }
  const fromSide = optionalText(value.fromSide)
  if (fromSide !== undefined) edge.fromSide = SIDES.has(fromSide) ? (fromSide as CanvasSide) : undefined
  const toSide = optionalText(value.toSide)
  if (toSide !== undefined) edge.toSide = SIDES.has(toSide) ? (toSide as CanvasSide) : undefined
  const fromEnd = optionalText(value.fromEnd)
  if (fromEnd !== undefined) edge.fromEnd = ENDS.has(fromEnd) ? (fromEnd as CanvasEnd) : undefined
  const toEnd = optionalText(value.toEnd)
  if (toEnd !== undefined) edge.toEnd = ENDS.has(toEnd) ? (toEnd as CanvasEnd) : undefined
  const color = optionalText(value.color)
  if (color !== undefined) edge.color = color
  const label = optionalText(value.label)
  if (label !== undefined) edge.label = label
  const edgeExtra = extras(value, EDGE_KEYS)
  if (edgeExtra) edge.$extra = edgeExtra
  return { edge, duplicate }
}

export class CanvasParseError extends Error {}

/**
 * Reads a `.canvas` file. Tolerant on purpose: a single malformed card must not
 * cost the other 67 (this is the file a user wrote in Obsidian).
 */
export function parseCanvas(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new CanvasParseError((error as Error).message)
  }
  if (!isRecord(data)) throw new CanvasParseError('el canvas no es un objeto JSON')

  const seenNodes = new Set<string>()
  const seenEdges = new Set<string>()
  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  let dropped = 0
  let duplicates = 0

  const rawNodes = Array.isArray(data.nodes) ? data.nodes : []
  for (const value of rawNodes) {
    const { node, duplicate } = parseNode(value, seenNodes)
    if (!node) {
      dropped++
      continue
    }
    if (duplicate) duplicates++
    nodes.push(node)
  }

  const rawEdges = Array.isArray(data.edges) ? data.edges : []
  for (const value of rawEdges) {
    const { edge, duplicate } = parseEdge(value, seenEdges)
    if (!edge) {
      dropped++
      continue
    }
    if (duplicate) duplicates++
    edges.push(edge)
  }

  return { canvas: { nodes, edges }, dropped, duplicates }
}

/** Cheap test used to route an uploaded or pasted file. */
export function looksLikeCanvas(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{')) return false
  try {
    const data = JSON.parse(trimmed)
    return isRecord(data) && (Array.isArray(data.nodes) || Array.isArray(data.edges))
  } catch {
    return false
  }
}

// ---------- writing ----------

/**
 * Python's `json.dumps` default separators, which is what Obsidian emits:
 * `{"a": 1, "b": [1, 2]}` on a single line, no trailing newline.
 */
const ITEM_SEPARATOR = ', '
const KEY_SEPARATOR = ': '

function encode(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(encode).join(ITEM_SEPARATOR)}]`
  if (isRecord(value)) {
    const parts = Object.keys(value).map((key) => `${JSON.stringify(key)}${KEY_SEPARATOR}${encode(value[key])}`)
    return `{${parts.join(ITEM_SEPARATOR)}}`
  }
  return 'null'
}

/**
 * Field order Obsidian writes, per node type. Obsidian itself parses any order;
 * matching its output is what makes an untouched canvas round-trip identically.
 */
function encodeNode(node: CanvasNode): Record<string, unknown> {
  const base: Record<string, unknown> = { id: node.id, type: node.type }
  if (node.type === 'text') base.text = node.text ?? ''
  else if (node.type === 'file') {
    base.file = node.file ?? ''
    if (node.subpath !== undefined) base.subpath = node.subpath
  } else if (node.type === 'link') base.url = node.url ?? ''
  else if (node.type === 'group') {
    // Obsidian writes an empty `text` on its own groups; another app's group
    // without the field must not gain one just because we saved the file.
    if (node.text !== undefined) base.text = node.text
  }

  base.x = node.x
  base.y = node.y
  base.width = node.width
  base.height = node.height

  if (node.type === 'group') {
    if (node.label !== undefined) base.label = node.label
    if (node.background !== undefined) base.background = node.background
    if (node.backgroundStyle !== undefined) base.backgroundStyle = node.backgroundStyle
  }
  if (node.color !== undefined) base.color = node.color

  // Unknown fields keep their own order, after the ones we understand.
  if (node.$extra) for (const key of Object.keys(node.$extra)) base[key] = node.$extra[key]
  return base
}

function encodeEdge(edge: CanvasEdge): Record<string, unknown> {
  // Built key by key, in order: assigning `undefined` first and deleting it
  // afterwards would leave the surviving keys in the wrong order.
  const base: Record<string, unknown> = { id: edge.id, fromNode: edge.fromNode }
  if (edge.fromSide !== undefined) base.fromSide = edge.fromSide
  if (edge.fromEnd !== undefined) base.fromEnd = edge.fromEnd
  base.toNode = edge.toNode
  if (edge.toSide !== undefined) base.toSide = edge.toSide
  if (edge.toEnd !== undefined) base.toEnd = edge.toEnd
  if (edge.color !== undefined) base.color = edge.color
  if (edge.label !== undefined) base.label = edge.label
  if (edge.$extra) for (const key of Object.keys(edge.$extra)) base[key] = edge.$extra[key]
  return base
}

/**
 * The `.canvas` text: nodes in array order (that array *is* the z-order), one
 * line, Obsidian's separators. No trailing newline — Obsidian writes none.
 */
export function serializeCanvas(canvas: CanvasDoc): string {
  const data: Record<string, unknown> = {
    nodes: canvas.nodes.map(encodeNode),
    edges: canvas.edges.map(encodeEdge),
  }
  return encode(data)
}

// ---------- helpers ----------

export function emptyCanvas(): CanvasDoc {
  return { nodes: [], edges: [] }
}

/**
 * What an untouched canvas note holds. Obsidian's own new canvas is this exact
 * file, and starting from it means a brand-new canvas is valid before anyone
 * edits it (an empty body would export as a 0-byte `.canvas`).
 */
export const EMPTY_CANVAS_JSON = '{"nodes": [], "edges": []}'

/** Obsidian ids are not required to be hex; ours are, for new cards. */
export function newNodeId(): string {
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function textNode(x: number, y: number, text = ''): CanvasNode {
  return { id: newNodeId(), type: 'text', x, y, ...DEFAULT_TEXT_SIZE, text }
}

export function groupNode(x: number, y: number, label = ''): CanvasNode {
  return { id: newNodeId(), type: 'group', x, y, ...DEFAULT_GROUP_SIZE, text: '', label }
}

export function linkNode(x: number, y: number, url: string): CanvasNode {
  return { id: newNodeId(), type: 'link', x, y, ...DEFAULT_LINK_SIZE, url }
}

export function fileNode(x: number, y: number, file: string, subpath?: string): CanvasNode {
  return { id: newNodeId(), type: 'file', x, y, ...DEFAULT_TEXT_SIZE, file, ...(subpath ? { subpath } : {}) }
}

/** Text that feeds the note's tags: card text and group labels, never the JSON. */
export function canvasText(canvas: CanvasDoc): string[] {
  const parts: string[] = []
  for (const node of canvas.nodes) {
    if (node.type === 'text' && node.text) parts.push(node.text)
    else if (node.type === 'group' && node.label) parts.push(node.label)
  }
  return parts
}

export function isCanvasNoteKind(kind: unknown): kind is 'canvas' {
  return kind === 'canvas'
}

/**
 * Tags of a canvas note, derived the same way markdown notes derive theirs: the
 * sidebar filters on `note.tags` without downloading bodies.
 */
export function canvasTagsOf(json: string): string[] {
  try {
    return extractTags(canvasText(parseCanvas(json).canvas).join('\n'))
  } catch {
    return []
  }
}
