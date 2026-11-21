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
