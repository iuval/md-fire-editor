import { describe, expect, it } from 'vitest'
import {
  MAX_FOLDER_DEPTH,
  buildFolderTree,
  canMoveFolder,
  flattenFolders,
  folderPath,
  subtreeHeight,
} from '../src/lib/folders'
import type { Folder } from '../src/lib/notes'

function folder(id: string, name: string, parentId: string | null = null): Folder {
  return {
    id,
    ownerId: 'u1',
    name,
    parentId,
    tags: [],
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
  }
}

const folders = [
  folder('g', 'GUIONES'),
  folder('lm', 'Los Muchachos', 'g'),
  folder('v3', 'V3', 'lm'),
  folder('inv', 'Investigaciones', 'lm'),
  folder('otro', 'Otro'),
  folder('orphan', 'Huérfana', 'missing'),
]

describe('folder tree', () => {
  it('nests children under their parent and keeps orphans at the root', () => {
    const tree = buildFolderTree(folders)
    const rootNames = tree.map((node) => node.folder.name)

    expect(rootNames).toEqual(['GUIONES', 'Huérfana', 'Otro'])

    const guiones = tree.find((node) => node.folder.name === 'GUIONES')!
    expect(guiones.children.map((n) => n.folder.name)).toEqual(['Los Muchachos'])
    expect(guiones.children[0].children.map((n) => n.folder.name)).toEqual(['Investigaciones', 'V3'])
    expect(guiones.children[0].children[0].depth).toBe(2)
  })

  it('builds readable paths and depths', () => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    expect(folderPath('v3', byId)).toBe('GUIONES/Los Muchachos/V3')
    expect(folderPath(null, byId)).toBe('')
    expect(folderPath('missing', byId)).toBe('')
  })

  it('flattens for menus, sorted by path', () => {
    const list = flattenFolders(folders)
    expect(list.map((n) => n.path)).toEqual([
      'GUIONES',
      'GUIONES/Los Muchachos',
      'GUIONES/Los Muchachos/Investigaciones',
      'GUIONES/Los Muchachos/V3',
      'Huérfana',
      'Otro',
    ])
  })

  it('survives a cycle instead of hanging', () => {
    const cyclic = [folder('a', 'A', 'b'), folder('b', 'B', 'a')]
    const byId = new Map(cyclic.map((f) => [f.id, f]))
    expect(folderPath('a', byId).length).toBeGreaterThan(0)
    expect(buildFolderTree(cyclic)).toHaveLength(0) // both have parents: no roots
  })

  it('refuses moves that would create a cycle', () => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    expect(canMoveFolder('g', 'v3', byId)).toBe(false) // parent into its own descendant
    expect(canMoveFolder('g', null, byId)).toBe(true)
    expect(canMoveFolder('v3', 'otro', byId)).toBe(true)
    expect(canMoveFolder('g', 'g', byId)).toBe(false)
  })

  it('measures subtree height for the depth cap', () => {
    expect(subtreeHeight('g', folders)).toBe(2)
    expect(subtreeHeight('v3', folders)).toBe(0)
    expect(MAX_FOLDER_DEPTH).toBeGreaterThan(0)
  })
})
