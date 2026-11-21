import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'

export type NoteAccess = 'restricted' | 'link-edit'
export type NoteRole = 'owner' | 'editor'

export interface NoteMember {
  uid: string
  role: NoteRole
}

export interface Note {
  id: string
  ownerId: string
  memberIds: string[]
  roles: Record<string, NoteRole>
  access: NoteAccess
  title: string
  markdown: string
  version: number
  createdAt?: { seconds: number } | null
  updatedAt?: { seconds: number } | null
}

export const MAX_MARKDOWN_BYTES = 250_000
export const MAX_TITLE_LENGTH = 300

export function canEdit(note: Note, uid: string | undefined): boolean {
  if (!uid) return false
  return note.memberIds.includes(uid) || note.access === 'link-edit'
}

export function isOwner(note: Note, uid: string | undefined): boolean {
  return !!uid && note.ownerId === uid
}

export function toNote(id: string, data: Record<string, unknown>): Note {
  return {
    id,
    ownerId: (data.ownerId as string) ?? '',
    memberIds: (data.memberIds as string[]) ?? [],
    roles: (data.roles as Record<string, NoteRole>) ?? {},
    access: ((data.access as NoteAccess) ?? 'restricted'),
    title: (data.title as string) ?? '',
    markdown: (data.markdown as string) ?? '',
    version: (data.version as number) ?? 0,
    createdAt: (data.createdAt as { seconds: number }) ?? null,
    updatedAt: (data.updatedAt as { seconds: number }) ?? null,
  }
}

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

export async function createNote(uid: string): Promise<Note> {
  if (!db) throw new Error('Firebase no está configurado')
  const ref = doc(collection(db, 'notes'))
  const now = serverTimestamp()
  await setDoc(ref, {
    ownerId: uid,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
    title: 'Nota sin título',
    markdown: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id: ref.id,
    ownerId: uid,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
    title: 'Nota sin título',
    markdown: '',
    version: 1,
  }
}

export async function saveNoteContent(
  noteId: string,
  patch: { title?: string; markdown?: string; version: number }
): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'notes', noteId), {
    ...patch,
    title: (patch.title ?? '').slice(0, MAX_TITLE_LENGTH),
    updatedAt: serverTimestamp(),
  })
}

export async function setNoteAccess(noteId: string, access: NoteAccess): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'notes', noteId), { access, updatedAt: serverTimestamp() })
}

export async function addNoteMember(noteId: string, note: Note, uid: string): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'notes', noteId), {
    memberIds: Array.from(new Set([...note.memberIds, uid])),
    roles: { ...note.roles, [uid]: 'editor' },
    updatedAt: serverTimestamp(),
  })
}

export async function removeNoteMember(noteId: string, note: Note, uid: string): Promise<void> {
  if (!db || uid === note.ownerId) return
  const memberIds = note.memberIds.filter((m) => m !== uid)
  const roles = { ...note.roles }
  delete roles[uid]
  await updateDoc(doc(db, 'notes', noteId), { memberIds, roles, updatedAt: serverTimestamp() })
}

export async function deleteNote(noteId: string): Promise<void> {
  if (!db) return
  await deleteDoc(doc(db, 'notes', noteId))
}

/**
 * One-time copy of the v1 schema (`users/{uid}/notes`) into the collaborative
 * schema. Legacy docs are removed only after the copy succeeds.
 */
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
        memberIds: [uid],
        roles: { [uid]: 'owner' },
        access: 'restricted',
        title: String(data.title ?? 'Nota sin título').slice(0, MAX_TITLE_LENGTH),
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
