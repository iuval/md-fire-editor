import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SORT,
  applyOrderOverride,
  compareByMode,
  moveOrder,
  nextOrder,
  orderKey,
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

describe('moveOrder: the cheapest write that produces the move', () => {
  const siblings = (orders: number[]) =>
    orders.map((order, index) => ({ id: `n${index}`, order }))

  /** Applies the move and returns the resulting display order. */
  const applied = (items: Array<{ id: string; order: number }>, id: string, direction: -1 | 1) => {
    const move = moveOrder(items, id, direction)
    if (!move) return null
    const next = items.map((item) => {
      const update = move.updates.find((entry) => entry.id === item.id)
      return update ? { ...item, order: update.order } : item
    })
    return next.sort((a, b) => a.order - b.order).map((item) => item.id)
  }

  it('moves an item down with a single write inside an existing gap', () => {
    const move = moveOrder(siblings([0, 10, 20]), 'n0', 1)
    expect(move?.kind).toBe('write')
    expect(move?.updates).toEqual([{ id: 'n0', order: 15 }])
    expect(move?.ids).toEqual(['n1', 'n0', 'n2'])
  })

  it('moves an item up with a single write', () => {
    expect(moveOrder(siblings([0, 10, 20]), 'n2', -1)).toEqual({
      kind: 'write',
      updates: [{ id: 'n2', order: 5 }],
      ids: ['n0', 'n2', 'n1'],
    })
  })

  it('can move to either end without touching anyone else', () => {
    expect(moveOrder(siblings([0, 10]), 'n1', -1)).toEqual({
      kind: 'write',
      updates: [{ id: 'n1', order: -10 }],
      ids: ['n1', 'n0'],
    })
    expect(moveOrder(siblings([0, 10]), 'n0', 1)).toEqual({
      kind: 'write',
      updates: [{ id: 'n0', order: 20 }],
      ids: ['n1', 'n0'],
    })
  })

  it('renumbers only when the gap is exhausted', () => {
    // 1 and 2 leave no integer between them.
    const move = moveOrder(siblings([0, 1, 2]), 'n0', 1)
    expect(move?.kind).toBe('renumber')
    expect(move?.updates).toEqual([
      { id: 'n1', order: 0 },
      { id: 'n0', order: 10 },
      { id: 'n2', order: 20 },
    ])
    expect(move?.ids).toEqual(['n1', 'n0', 'n2'])
  })

  it('does nothing at the ends of the list', () => {
    expect(moveOrder(siblings([0, 10]), 'n0', -1)).toBeNull()
    expect(moveOrder(siblings([0, 10]), 'n1', 1)).toBeNull()
    expect(moveOrder(siblings([0, 10]), 'missing', 1)).toBeNull()
  })

  it('always produces the move it was asked for, whatever the gaps', () => {
    const layouts = [
      [0, 10, 20],
      [0, 1, 2],
      [0, 1, 10],
      [-10, 0, 10],
      [5, 25, 90],
      [0, 10, 11, 12, 20],
      [0, 0, 10],
    ]
    for (const orders of layouts) {
      for (const direction of [-1, 1] as const) {
        const items = siblings(orders)
        for (let index = 0; index < items.length; index++) {
          const id = items[index].id
          const target = index + direction
          if (target < 0 || target >= items.length) continue
          const result = applied(items, id, direction)
          const expected = items.map((item) => item.id)
          ;[expected[index], expected[target]] = [expected[target], expected[index]]
          expect(`${orders} ${direction} ${id} -> ${result}`).toBe(
            `${orders} ${direction} ${id} -> ${expected}`
          )
        }
      }
    }
  })
})

describe('optimistic order override', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('shows the order the move asked for before the server answers', () => {
    expect(applyOrderOverride(items, ['c', 'a', 'b']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the list alone without an override', () => {
    expect(applyOrderOverride(items, undefined)).toBe(items)
    expect(applyOrderOverride(items, [])).toBe(items)
  })

  it('keeps unknown items at the end instead of dropping them', () => {
    // A note created on another device is not in the override yet.
    const withNew = [...items, { id: 'zz' }]
    expect(applyOrderOverride(withNew, ['c', 'a', 'b']).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'zz',
    ])
  })

  it('keys overrides per collection and parent', () => {
    expect(orderKey('notes', null)).toBe('notes:root')
    expect(orderKey('folders', 'f1')).toBe('folders:f1')
  })
})
