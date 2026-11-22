import type { Folder, Note } from './notes'

export type SortMode = 'name' | 'created' | 'updated' | 'manual'

export const SORT_LABELS: Record<SortMode, string> = {
  name: 'Nombre (A-Z)',
  created: 'Fecha de creación',
  updated: 'Fecha de modificación',
  manual: 'Manual',
}

export const DEFAULT_SORT: SortMode = 'name'

export function isSortMode(value: unknown): value is SortMode {
  return value === 'name' || value === 'created' || value === 'updated' || value === 'manual'
}

function seconds(ts?: { seconds: number } | null): number {
  return ts?.seconds ?? 0
}

/**
 * Sort mode inherited from the folder chain: a folder without its own setting
 * uses its parent's, all the way to the root preference.
 */
export function resolveSort(
  folderId: string | null,
  byId: Map<string, Folder>,
  rootSort: SortMode = DEFAULT_SORT
): SortMode {
  let current = folderId
  let guard = 0
  while (current && guard++ < 32) {
    const folder = byId.get(current)
    if (!folder) break
    if (folder.sort) return folder.sort
    current = folder.parentId
  }
  return rootSort
}

/** Comparator for folders and notes; ties fall back to the name so it is stable. */
export function compareByMode(
  a: { name: string; createdAt?: { seconds: number } | null; updatedAt?: { seconds: number } | null; order?: number },
  b: { name: string; createdAt?: { seconds: number } | null; updatedAt?: { seconds: number } | null; order?: number },
  mode: SortMode
): number {
  const byName = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })

  if (mode === 'manual') {
    const byOrder = (a.order ?? 0) - (b.order ?? 0)
    return byOrder !== 0 ? byOrder : byName
  }
  if (mode === 'created') {
    const byCreated = seconds(a.createdAt) - seconds(b.createdAt)
    return byCreated !== 0 ? byCreated : byName
  }
  if (mode === 'updated') {
    const byUpdated = seconds(b.updatedAt) - seconds(a.updatedAt)
    return byUpdated !== 0 ? byUpdated : byName
  }
  return byName
}

export function sortFolders(folders: Folder[], mode: SortMode): Folder[] {
  return [...folders].sort((a, b) =>
    compareByMode({ ...a, name: a.name }, { ...b, name: b.name }, mode)
  )
}

export function sortNotes(notes: Note[], mode: SortMode): Note[] {
  return [...notes].sort((a, b) =>
    compareByMode(
      { ...a, name: a.title || 'Sin título' },
      { ...b, name: b.title || 'Sin título' },
      mode
    )
  )
}

/** Next manual position for an item appended to a sibling list. */
export function nextOrder(siblings: Array<{ order?: number }>): number {
  if (siblings.length === 0) return 0
  return Math.max(...siblings.map((item) => item.order ?? 0)) + 10
}

/**
 * Renumbers a sibling list 0..n-1 (× 10) after a move; returns the id → order
 * pairs that must be persisted.
 */
export function renumbered(idsInOrder: string[]): Array<{ id: string; order: number }> {
  return idsInOrder.map((id, index) => ({ id, order: index * 10 }))
}

/** What a manual move has to persist. */
export interface OrderMove {
  /**
   * `write`: one document gets a new order (the gap was big enough).
   * `renumber`: every sibling is renumbered because there was no integer left.
   */
  kind: 'write' | 'renumber'
  updates: Array<{ id: string; order: number }>
  /** Display order after the move, so the UI can show it before the server. */
  ids: string[]
}

export interface OrderedItem {
  id: string
  order?: number
}

/**
 * Moves one item up or down among its siblings, touching as little as possible.
 *
 * The old implementation renumbered and rewrote *every* sibling on each click:
 * moving a note inside a folder with 100 notes meant 100 writes, each bumping
 * `updatedAt` (which the note list is ordered by, so the whole sidebar snapshot
 * fired again) — and past 500 siblings the batch exceeded Firestore's limit.
 * The 10-unit gaps `renumbered` leaves allow dropping the moved item into the
 * gap with a single write; only when a gap is exhausted do we renumber.
 *
 * `items` must be in display order (the same order the user sees).
 */
export function moveOrder(
  items: OrderedItem[],
  id: string,
  direction: -1 | 1
): OrderMove | null {
  const index = items.findIndex((item) => item.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return null

  const orderAt = (position: number): number | null =>
    position < 0 || position >= items.length ? null : (items[position].order ?? 0)

  // Exclusive bounds for the new value: the sibling the item jumps over on one
  // side, and the next one along on the other side (absent at the ends).
  const lower = direction === -1 ? orderAt(target - 1) : orderAt(target)
  const upper = direction === -1 ? orderAt(target) : orderAt(target + 1)

  let next: number | null
  if (lower === null && upper !== null) next = upper - 10
  else if (upper === null && lower !== null) next = lower + 10
  else if (lower !== null && upper !== null) {
    next = upper - lower > 1 ? Math.floor((lower + upper) / 2) : null
  } else return null

  const swapped = items.map((item) => item.id)
  ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]

  // Same value as the item already has (duplicate orders): renumber instead.
  if (next !== null && next !== (orderAt(index) ?? 0)) {
    return { kind: 'write', updates: [{ id, order: next }], ids: swapped }
  }
  return { kind: 'renumber', updates: renumbered(swapped), ids: swapped }
}

/**
 * Applies an order the user just asked for, before the server confirms it.
 *
 * A manual move is a write plus a round trip: without this the row sits still
 * until the snapshot arrives. Items missing from `ids` keep their relative
 * position at the end, so a note created on another device never disappears.
 */
export function applyOrderOverride<T extends { id: string }>(items: T[], ids?: string[]): T[] {
  if (!ids || ids.length === 0) return items
  const rank = new Map(ids.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const left = rank.get(a.id)
    const right = rank.get(b.id)
    if (left === undefined && right === undefined) return 0
    if (left === undefined) return 1
    if (right === undefined) return -1
    return left - right
  })
}

/** Key used to remember a pending order for a folder's children. */
export function orderKey(kind: 'notes' | 'folders', parentId: string | null): string {
  return `${kind}:${parentId ?? 'root'}`
}
