import { describe, expect, it } from 'vitest'
import { nextOrder, renumbered, resolveSort, sortFolders, sortNotes } from '../src/lib/sorting'
import type { Folder, Note } from '../src/lib/notes'

function folder(id: string, name: string, parentId: string | null = null, extra: Partial<Folder> = {}): Folder {
  return {
    id,
    ownerId: 'u1',
    name,
    parentId,
    order: 0,
    tags: [],
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    ...extra,
  }
}

function note(id: string, title: string, order = 0): Note {
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
    order,
    version: 1,
  }
}

describe('manual ordering applied to a real folder', () => {
  it('new folders inherit the parent sort and append at the end', () => {
    const parent = folder('p', 'Proyecto', null, { sort: 'updated' })
    const byId = new Map([[parent.id, parent]])
    const siblings = [folder('a', 'A', 'p', { order: 0 }), folder('b', 'B', 'p', { order: 10 })]

    // What App does when creating a folder inside `p`.
    const inherited = resolveSort('p', byId)
    const order = nextOrder(siblings)

    expect(inherited).toBe('updated')
    expect(order).toBe(20)
    expect(folder('c', 'C', 'p', { sort: inherited, order }).sort).toBe('updated')
  })

  it('moving up swaps two notes and renumbers the list', () => {
    const notes = [note('a', 'A', 0), note('b', 'B', 10), note('c', 'C', 20)]
    const ordered = sortNotes(notes, 'manual').map((n) => n.id)
    const index = ordered.indexOf('c')
    ;[ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]]

    const pairs = renumbered(ordered)
    expect(pairs).toEqual([
      { id: 'a', order: 0 },
      { id: 'c', order: 10 },
      { id: 'b', order: 20 },
    ])

    // Applying the pairs produces the wanted visual order.
    const updated = notes.map((n) => ({ ...n, order: pairs.find((p) => p.id === n.id)!.order }))
    expect(sortNotes(updated, 'manual').map((n) => n.title)).toEqual(['A', 'C', 'B'])
  })

  it('moving a folder up among mixed siblings keeps names stable', () => {
    const folders = [folder('x', 'X', null, { order: 0 }), folder('y', 'Y', null, { order: 10 })]
    const ordered = sortFolders(folders, 'manual').map((f) => f.id)
    ;[ordered[0], ordered[1]] = [ordered[1], ordered[0]]
    const updated = folders.map((f) => ({ ...f, order: renumbered(ordered).find((p) => p.id === f.id)!.order }))
    expect(sortFolders(updated, 'manual').map((f) => f.name)).toEqual(['Y', 'X'])
  })
})
