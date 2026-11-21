import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SORT,
  compareByMode,
  nextOrder,
  renumbered,
  resolveSort,
  sortFolders,
  sortNotes,
} from '../src/lib/sorting'
import type { Folder, Note } from '../src/lib/notes'

function folder(id: string, name: string, extra: Partial<Folder> = {}): Folder {
  return {
    id,
    ownerId: 'u1',
    name,
    parentId: null,
    tags: [],
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    ...extra,
  }
}

function note(id: string, title: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own',
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    title,
    markdown: '',
    tags: [],
    version: 1,
    ...extra,
  }
}

const t = (seconds: number) => ({ seconds })

describe('sort modes', () => {
  const notes = [
    note('b', 'Beta', { createdAt: t(300), updatedAt: t(100), order: 20 }),
    note('a', 'alfa', { createdAt: t(100), updatedAt: t(300), order: 0 }),
    note('c', 'Gamma', { createdAt: t(200), updatedAt: t(200), order: 10 }),
  ]

  it('sorts by name, case-insensitive and accent aware', () => {
    expect(sortNotes(notes, 'name').map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by creation date, oldest first', () => {
    expect(sortNotes(notes, 'created').map((n) => n.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by modification date, newest first', () => {
    expect(sortNotes(notes, 'updated').map((n) => n.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by manual order', () => {
    expect(sortNotes(notes, 'manual').map((n) => n.id)).toEqual(['a', 'c', 'b'])
  })

  it('is stable: equal values fall back to the name', () => {
    const tie = [
      note('x', 'Zeta', { createdAt: t(100), order: 0 }),
      note('y', 'Alfa', { createdAt: t(100), order: 0 }),
    ]
    expect(sortNotes(tie, 'created').map((n) => n.id)).toEqual(['y', 'x'])
    expect(sortNotes(tie, 'manual').map((n) => n.id)).toEqual(['y', 'x'])
  })

  it('treats missing timestamps and orders as zero', () => {
    expect(compareByMode({ name: 'a' }, { name: 'b' }, 'created')).toBeLessThan(0)
    expect(compareByMode({ name: 'a', createdAt: t(5) }, { name: 'b' }, 'created')).toBeGreaterThan(0)
  })

  it('sorts folders with the same comparator', () => {
    const folders = [folder('f2', 'Zeta', { createdAt: t(1) }), folder('f1', 'Alfa', { createdAt: t(9) })]
    expect(sortFolders(folders, 'name').map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(sortFolders(folders, 'created').map((f) => f.id)).toEqual(['f2', 'f1'])
  })
})

describe('inheritance', () => {
  const folders = [
    folder('root-created', 'Raíz con creado', { sort: 'created' }),
    folder('child-inherits', 'Hija', { parentId: 'root-created' }),
    folder('grandchild', 'Nieta', { parentId: 'child-inherits' }),
    folder('child-manual', 'Hija manual', { parentId: 'root-created', sort: 'manual' }),
  ]
  const byId = new Map(folders.map((f) => [f.id, f]))

  it('inherits through the chain', () => {
    expect(resolveSort('root-created', byId)).toBe('created')
    expect(resolveSort('child-inherits', byId)).toBe('created')
    expect(resolveSort('grandchild', byId)).toBe('created')
    expect(resolveSort('child-manual', byId)).toBe('manual')
  })

  it('falls back to the root preference, then to the default', () => {
    expect(resolveSort(null, byId, 'updated')).toBe('updated')
    expect(resolveSort(null, byId)).toBe(DEFAULT_SORT)
    expect(resolveSort('missing', byId)).toBe(DEFAULT_SORT)
  })

  it('survives a cyclic chain', () => {
    const cyclic = [
      folder('a', 'A', { parentId: 'b' }),
      folder('b', 'B', { parentId: 'a', sort: 'updated' }),
    ]
    expect(resolveSort('a', new Map(cyclic.map((f) => [f.id, f])))).toBe('updated')
  })
})

describe('manual positions', () => {
  it('appends after the highest order', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([{ order: 0 }, { order: 20 }])).toBe(30)
    expect(nextOrder([{}, { order: 5 }])).toBe(15)
  })

  it('renumbers with gaps', () => {
    expect(renumbered(['a', 'b', 'c'])).toEqual([
      { id: 'a', order: 0 },
      { id: 'b', order: 10 },
      { id: 'c', order: 20 },
    ])
  })
})
