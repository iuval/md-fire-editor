import type { Folder, Note } from './notes'

export const MAX_FOLDER_DEPTH = 6

export interface FolderNode {
  folder: Folder
  depth: number
  /** `A/B/C`, used in labels, moves and exports. */
  path: string
  children: FolderNode[]
}

function parentOf(folder: Folder): string | null {
  return folder.parentId ?? null
}

/** Ancestors first, target last. Stops on cycles so a bad document cannot hang the UI. */
export function folderChain(folderId: string, byId: Map<string, Folder>): Folder[] {
  const chain: Folder[] = []
  const seen = new Set<string>()
  let current = byId.get(folderId)

  while (current && !seen.has(current.id) && chain.length < 32) {
    seen.add(current.id)
    chain.unshift(current)
    const parentId = parentOf(current)
    current = parentId ? byId.get(parentId) : undefined
  }
  return chain
}

export function folderPath(folderId: string | null, byId: Map<string, Folder>): string {
  if (!folderId) return ''
  return folderChain(folderId, byId)
    .map((folder) => folder.name)
    .join('/')
}

export function folderDepth(folderId: string | null, byId: Map<string, Folder>): number {
  if (!folderId) return 0
  return folderChain(folderId, byId).length
}

/** Catalog sorted by path, flattened — for selects and menus. */
export function flattenFolders(folders: Folder[]): FolderNode[] {
  return folders
    .map((folder) => ({
      folder,
      depth: folderDepth(folder.id, new Map(folders.map((f) => [f.id, f]))) - 1,
      path: folderPath(folder.id, new Map(folders.map((f) => [f.id, f]))),
      children: [] as FolderNode[],
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'es'))
}

/** Nested tree, roots first, with orphans treated as roots. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  for (const folder of folders) {
    nodes.set(folder.id, { folder, depth: 0, path: '', children: [] })
  }

  for (const folder of folders) {
    const node = nodes.get(folder.id)!
    const parentId = parentOf(folder)
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const assign = (list: FolderNode[], depth: number, prefix: string) => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name, 'es'))
    for (const node of list) {
      node.depth = depth
      node.path = prefix ? `${prefix}/${node.folder.name}` : node.folder.name
      assign(node.children, depth + 1, node.path)
    }
  }
  assign(roots, 0, '')

  return roots
}

/** True when moving `folderId` under `targetId` would create a cycle or pass the depth cap. */
export function canMoveFolder(
  folderId: string,
  targetParentId: string | null,
  byId: Map<string, Folder>
): boolean {
  if (!targetParentId) return true
  if (targetParentId === folderId) return false

  let current: string | null = targetParentId
  let guard = 0
  while (current && guard++ < 32) {
    if (current === folderId) return false
    current = byId.get(current)?.parentId ?? null
  }
  return true
}

/** Folder whose permission is in effect for a note that inherits its ACL. */
export function sharedFolderOf(note: Note, folders: Folder[]): Folder | null {
  if (note.aclSource !== 'folder' || !note.folderId) return null
  return folders.find((folder) => folder.id === note.folderId) ?? null
}

/** Depth of the subtree rooted at `folderId`, so a move cannot exceed the cap. */
export function subtreeHeight(folderId: string, folders: Folder[]): number {
  const children = folders.filter((folder) => folder.parentId === folderId)
  if (children.length === 0) return 0
  return 1 + Math.max(...children.map((child) => subtreeHeight(child.id, folders)))
}
