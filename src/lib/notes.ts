import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { canReadAcl, canWriteAcl, type Access, type Acl, type Role } from './acl'

export type { Access, Acl, Role } from './acl'
export { ACCESS_LABELS, ROLE_LABELS, aclMembers, canReadAcl, canWriteAcl, isAclOwner, roleOf } from './acl'

export type AclSource = 'own' | 'folder'

export interface Note extends Acl {
  id: string
  ownerId: string
  folderId: string | null
  aclSource: AclSource
  title: string
  markdown: string
  /** Derived from the markdown on save; used to filter without downloading bodies. */
  tags: string[]
  version: number
  createdAt?: Timestampish | null
  updatedAt?: Timestampish | null
}

export interface Folder extends Acl {
  id: string
  ownerId: string
  name: string
  parentId: string | null
  tags: string[]
  createdAt?: Timestampish | null
  updatedAt?: Timestampish | null
}

interface Timestampish {
  seconds: number
}

export const MAX_MARKDOWN_BYTES = 250_000
export const MAX_TITLE_LENGTH = 300
export const MAX_FOLDER_NAME = 120

// ---------- mapping ----------

function aclFrom(data: Record<string, unknown>): Acl {
  return {
    memberIds: (data.memberIds as string[]) ?? [],
    roles: (data.roles as Record<string, Role>) ?? {},
    access: ((data.access as Access) ?? 'restricted'),
  }
}

export function toNote(id: string, data: Record<string, unknown>): Note {
  return {
    id,
    ownerId: (data.ownerId as string) ?? '',
    folderId: (data.folderId as string | null) ?? null,
    aclSource: ((data.aclSource as AclSource) ?? 'own'),
    ...aclFrom(data),
    title: (data.title as string) ?? '',
    markdown: (data.markdown as string) ?? '',
    tags: (data.tags as string[]) ?? [],
    version: (data.version as number) ?? 0,
    createdAt: (data.createdAt as Timestampish) ?? null,
    updatedAt: (data.updatedAt as Timestampish) ?? null,
  }
}

export function toFolder(id: string, data: Record<string, unknown>): Folder {
  return {
    id,
    ownerId: (data.ownerId as string) ?? '',
    name: (data.name as string) ?? '',
    parentId: (data.parentId as string | null) ?? null,
    tags: (data.tags as string[]) ?? [],
    ...aclFrom(data),
    createdAt: (data.createdAt as Timestampish) ?? null,
    updatedAt: (data.updatedAt as Timestampish) ?? null,
  }
}

const CLOSED_ACL: Acl = { memberIds: [], roles: {}, access: 'restricted' }

/**
 * A note inherits its folder's ACL unless it carries its own. Unknown or
 * deleted folders resolve to a closed ACL — same fail-closed behaviour the
 * rules implement.
 */
export function effectiveAcl(note: Note, folders: Folder[]): Acl {
  if (note.aclSource === 'folder') {
    const folder = folders.find((f) => f.id === note.folderId)
    return folder
      ? { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
      : CLOSED_ACL
  }
  return { memberIds: note.memberIds, roles: note.roles, access: note.access }
}

export function noteCanEdit(note: Note, folders: Folder[], uid: string | undefined): boolean {
  return canWriteAcl(effectiveAcl(note, folders), uid)
}

export function noteCanRead(note: Note, folders: Folder[], uid: string | undefined): boolean {
  return canReadAcl(effectiveAcl(note, folders), uid)
}

// ---------- subscriptions ----------

export function subscribeMyNotes(
  uid: string,
  onChange: (notes: Note[]) => void,
  onError: (message: string) => void
): () => void {
  if (!db) return () => undefined
  const q = query(
    collection(db, 'notes'),
    where('memberIds', 'array-contains', uid),
    orderBy('updatedAt', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toNote(d.id, d.data()))),
    (err) => onError(err.message)
  )
}

export function subscribeMyFolders(
  uid: string,
  onChange: (folders: Folder[]) => void,
  onError: (message: string) => void
): () => void {
  if (!db) return () => undefined
  const q = query(
    collection(db, 'folders'),
    where('memberIds', 'array-contains', uid),
    orderBy('name', 'asc')
  )
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toFolder(d.id, d.data()))),
    (err) => onError(err.message)
  )
}

export function subscribeNote(
  noteId: string,
  onChange: (note: Note | null) => void,
  onError: (message: string) => void
): () => void {
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'notes', noteId),
    (snap) => onChange(snap.exists() ? toNote(snap.id, snap.data()) : null),
    (err) => onError(err.message)
  )
}

// ---------- notes ----------

export async function createNote(uid: string, folder?: Folder): Promise<Note> {
  if (!db) throw new Error('Firebase no está configurado')
  const ref = doc(collection(db, 'notes'))
  const now = serverTimestamp()
  const acl: Acl = folder
    ? { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
    : { memberIds: [uid], roles: { [uid]: 'owner' }, access: 'restricted' }

  await setDoc(ref, {
    ownerId: uid,
    folderId: folder ? folder.id : null,
    aclSource: folder ? 'folder' : 'own',
    ...acl,
    title: 'Sin título',
    markdown: '',
    tags: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id: ref.id,
    ownerId: uid,
    folderId: folder ? folder.id : null,
    aclSource: folder ? 'folder' : 'own',
    ...acl,
    title: 'Sin título',
    markdown: '',
    tags: [],
    version: 1,
  }
}

/**
 * Partial update: only the fields present in the patch are written.
 *
 * This used to always write `title`, defaulting to an empty string, so saving
 * markdown (which does not carry the title) wiped the note's title on every
 * save — one second after opening it.
 */
/** Only the fields present in the patch end up in the write. */
export function buildNoteUpdate(patch: {
  title?: string
  markdown?: string
  tags?: string[]
  version?: number
}): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title.slice(0, MAX_TITLE_LENGTH)
  if (patch.markdown !== undefined) update.markdown = patch.markdown
  if (patch.tags !== undefined) update.tags = patch.tags
  if (patch.version !== undefined) update.version = patch.version
  return update
}

export async function saveNoteContent(
  noteId: string,
  patch: { title?: string; markdown?: string; tags?: string[]; version?: number }
): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'notes', noteId), {
    ...buildNoteUpdate(patch),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Move a note into a folder (inheriting its ACL) or back to the root, where it
 * becomes private to its owner again.
 */
export async function moveNoteTo(note: Note, target: Folder | null): Promise<void> {
  if (!db) return
  const acl: Acl = target
    ? { memberIds: target.memberIds, roles: target.roles, access: target.access }
    : { memberIds: [note.ownerId], roles: { [note.ownerId]: 'owner' }, access: 'restricted' }

  await updateDoc(doc(db, 'notes', note.id), {
    folderId: target ? target.id : null,
    aclSource: target ? 'folder' : 'own',
    ...acl,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteNote(noteId: string): Promise<void> {
  if (!db) return
  await deleteDoc(doc(db, 'notes', noteId))
}

// ---------- folders ----------

export async function createFolder(
  uid: string,
  name: string,
  parentId: string | null = null,
  tags: string[] = []
): Promise<Folder> {
  if (!db) throw new Error('Firebase no está configurado')
  const ref = doc(collection(db, 'folders'))
  const now = serverTimestamp()
  const clean = name.trim().slice(0, MAX_FOLDER_NAME) || 'Carpeta'
  await setDoc(ref, {
    ownerId: uid,
    name: clean,
    parentId,
    tags,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
    createdAt: now,
    updatedAt: now,
  })
  return {
    id: ref.id,
    ownerId: uid,
    name: clean,
    parentId,
    tags,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
  }
}

export async function moveFolder(folderId: string, parentId: string | null): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { parentId, updatedAt: serverTimestamp() })
}

export async function updateFolderTags(folderId: string, tags: string[]): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { tags, updatedAt: serverTimestamp() })
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), {
    name: name.trim().slice(0, MAX_FOLDER_NAME) || 'Carpeta',
    updatedAt: serverTimestamp(),
  })
}

export async function setFolderAccess(folderId: string, access: Access): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { access, updatedAt: serverTimestamp() })
}

/** Remove the folder, moving its notes back to the root first. */
export async function deleteFolder(folderId: string): Promise<void> {
  if (!db) return
  const notesSnap = await getDocs(query(collection(db, 'notes'), where('folderId', '==', folderId)))
  const batch = writeBatch(db)
  notesSnap.forEach((docSnap) => {
    const data = docSnap.data()
    const owner = data.ownerId as string
    batch.update(docSnap.ref, {
      folderId: null,
      aclSource: 'own',
      memberIds: [owner],
      roles: { [owner]: 'owner' },
      access: 'restricted',
      updatedAt: serverTimestamp(),
    })
  })
  await batch.commit()

  // Nested folders are re-attached to the deleted folder's parent.
  const childSnap = await getDocs(query(collection(db, 'folders'), where('parentId', '==', folderId)))
  if (!childSnap.empty) {
    const parentId = (await getDoc(doc(db, 'folders', folderId))).data()?.parentId ?? null
    const reparent = writeBatch(db)
    childSnap.forEach((child) => {
      reparent.update(child.ref, { parentId, updatedAt: serverTimestamp() })
    })
    await reparent.commit()
  }

  await deleteDoc(doc(db, 'folders', folderId))
}

// ---------- sharing ----------

function withMember(acl: Acl, uid: string, role: Role): Acl {
  const memberIds = Array.from(new Set([...acl.memberIds, uid]))
  return { ...acl, memberIds, roles: { ...acl.roles, [uid]: role } }
}

function withoutMember(acl: Acl, uid: string, ownerId: string): Acl {
  if (uid === ownerId) return acl
  const roles = { ...acl.roles }
  delete roles[uid]
  return { ...acl, memberIds: acl.memberIds.filter((m) => m !== uid), roles }
}

export async function updateNoteSharing(
  note: Note,
  change: { access?: Access; addMember?: { uid: string; role: Role }; removeMember?: string; setRole?: { uid: string; role: Role } }
): Promise<void> {
  if (!db) return
  if (note.aclSource === 'folder') {
    throw new Error('Esta nota hereda los permisos de su carpeta. Cambiá el acceso de la carpeta.')
  }

  let next: Acl = { memberIds: note.memberIds, roles: note.roles, access: note.access }
  if (change.access) next = { ...next, access: change.access }
  if (change.addMember) next = withMember(next, change.addMember.uid, change.addMember.role)
  if (change.setRole) next = withMember(next, change.setRole.uid, change.setRole.role)
  if (change.removeMember) next = withoutMember(next, change.removeMember, note.ownerId)

  await updateDoc(doc(db, 'notes', note.id), { ...next, updatedAt: serverTimestamp() })
}

export async function updateFolderSharing(
  folder: Folder,
  change: { access?: Access; addMember?: { uid: string; role: Role }; removeMember?: string; setRole?: { uid: string; role: Role } }
): Promise<void> {
  if (!db) return

  let next: Acl = { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
  if (change.access) next = { ...next, access: change.access }
  if (change.addMember) next = withMember(next, change.addMember.uid, change.addMember.role)
  if (change.setRole) next = withMember(next, change.setRole.uid, change.setRole.role)
  if (change.removeMember) next = withoutMember(next, change.removeMember, folder.ownerId)

  await updateDoc(doc(db, 'folders', folder.id), { ...next, updatedAt: serverTimestamp() })

  // Security already follows the folder document (rules resolve inherited ACLs
  // live). This only refreshes the copies used by the sidebar query.
  await propagateFolderAcl(folder.id, next)
}

async function propagateFolderAcl(folderId: string, acl: Acl): Promise<void> {
  if (!db) return
  const snap = await getDocs(query(collection(db, 'notes'), where('folderId', '==', folderId)))
  const stale = snap.docs.filter((d) => d.data().aclSource === 'folder')
  if (stale.length === 0) return

  const batch = writeBatch(db)
  stale.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      memberIds: acl.memberIds,
      roles: acl.roles,
      access: acl.access,
      updatedAt: serverTimestamp(),
    })
  })
  await batch.commit()
}

export async function getFolder(folderId: string): Promise<Folder | null> {
  if (!db) return null
  const snap = await getDoc(doc(db, 'folders', folderId))
  return snap.exists() ? toFolder(snap.id, snap.data()) : null
}

// ---------- migration ----------

const MIGRATION_FLAG = 'mdfire-migrated-v2'

export async function migrateLegacyNotes(uid: string): Promise<number> {
  if (!db) return 0
  const legacy = await getDocs(collection(db, 'users', uid, 'notes'))
  if (legacy.empty) return 0

  let migrated = 0
  for (const legacyDoc of legacy.docs) {
    const data = legacyDoc.data()
    const target = doc(collection(db, 'notes'))
    const now = serverTimestamp()
    try {
      await setDoc(target, {
        ownerId: uid,
        folderId: null,
        aclSource: 'own',
        memberIds: [uid],
        roles: { [uid]: 'owner' },
        access: 'restricted',
        title: String(data.title ?? 'Sin título').slice(0, MAX_TITLE_LENGTH),
        markdown: String(data.content ?? '').slice(0, MAX_MARKDOWN_BYTES),
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      await deleteDoc(legacyDoc.ref)
      migrated++
    } catch {
      // Keep the legacy document when the copy fails.
    }
  }
  return migrated
}

export { MIGRATION_FLAG }
