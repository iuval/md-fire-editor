import { t } from '../i18n/index.ts'
import {
  collection,
  deleteField,
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
import { postBody, proxyEnabled } from './proxy'
import {
  applyLocalOrder,
  createLocalFolder,
  createLocalNote,
  deleteLocalFolder,
  deleteLocalNote,
  fetchLocalBodies,
  getLocalFolder,
  importLocalNotes,
  isLocalMode,
  moveLocalFolder,
  moveLocalNoteTo,
  renameLocalFolder,
  reserveLocalFolderId,
  reserveLocalNoteId,
  saveLocalNoteContent,
  setLocalFolderSort,
  setLocalRootSort,
  subscribeLocalBody,
  subscribeLocalFolders,
  subscribeLocalNote,
  subscribeLocalNotes,
  subscribeLocalSettings,
  updateLocalFolderTags,
} from './localStore'
import { canReadAcl, canWriteAcl, type Access, type Acl, type Role } from './acl'
import { DEFAULT_SORT, type SortMode } from './sorting'
import { EMPTY_CANVAS_JSON, MAX_CANVAS_CHARS } from './canvas/model'

export type { Access, Acl, Role } from './acl'
export { accessLabel, roleLabel, aclMembers, canReadAcl, canWriteAcl, isAclOwner, roleOf } from './acl'

export type AclSource = 'own' | 'folder'

/**
 * What a note holds. `note` is markdown; `canvas` is a JSON Canvas document in
 * the same body field (see `lib/canvas/model`). Absent on notes written before
 * canvases existed, which read as `note`.
 */
export type NoteKind = 'note' | 'canvas'

export interface Note extends Acl {
  id: string
  ownerId: string
  folderId: string | null
  aclSource: AclSource
  kind: NoteKind
  title: string
  /**
   * The body. Only filled for a note that is open (its `body/main` is
   * subscribed) or for a legacy note that still carries `markdown` inline; the
   * workspace list never downloads bodies.
   */
  markdown: string
  /** Size of the body in characters, kept on the note so the list can total it. */
  markdownBytes?: number
  /** Derived from the markdown on save; used to filter without downloading bodies. */
  tags: string[]
  /** Position inside its folder when the folder sorts manually. */
  order: number
  version: number
  createdAt?: Timestampish | null
  updatedAt?: Timestampish | null
}

export interface Folder extends Acl {
  id: string
  ownerId: string
  name: string
  parentId: string | null
  /** How this folder orders its children; `undefined` inherits from the parent. */
  sort?: SortMode
  /** Position inside its parent when the parent sorts manually. */
  order: number
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
    kind: data.kind === 'canvas' ? 'canvas' : 'note',
    ...aclFrom(data),
    title: (data.title as string) ?? '',
    markdown: (data.markdown as string) ?? '',
    markdownBytes: typeof data.markdownBytes === 'number' ? data.markdownBytes : undefined,
    tags: (data.tags as string[]) ?? [],
    order: (data.order as number) ?? 0,
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
    sort: (data.sort as SortMode | undefined) ?? undefined,
    order: (data.order as number) ?? 0,
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
  if (isLocalMode()) return subscribeLocalNotes(uid, onChange)
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
  if (isLocalMode()) return subscribeLocalFolders(uid, onChange)
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
  if (isLocalMode()) return subscribeLocalNote(noteId, onChange)
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'notes', noteId),
    (snap) => onChange(snap.exists() ? toNote(snap.id, snap.data()) : null),
    (err) => onError(err.message)
  )
}

/** The note body document. Kept apart so the workspace list stays small. */
function bodyRef(noteId: string) {
  return doc(db!, 'notes', noteId, 'body', 'main')
}

/**
 * The body of one note, live.
 *
 * This replaces the whole-document subscription the app used to keep per open
 * note: the note's metadata already arrives through the workspace list, so what
 * a pane needs is only the text.
 */
export function subscribeNoteBody(
  noteId: string,
  onChange: (body: string | null) => void,
  onError: (message: string) => void
): () => void {
  if (isLocalMode()) return subscribeLocalBody(noteId, onChange)
  if (!db) return () => undefined
  return onSnapshot(
    bodyRef(noteId),
    (snap) => onChange(snap.exists() ? ((snap.data().markdown as string) ?? '') : null),
    (err) => onError(err.message)
  )
}

/**
 * Bodies for notes that are not open (export a vault, rename a tag).
 *
 * Notes written before the split still keep the text in the note document, so
 * the fallback reads it from there instead of reporting an empty note.
 */
export async function fetchNoteBodies(
  noteIds: string[],
  { onProgress, concurrency = 8 }: { onProgress?: (done: number) => void; concurrency?: number } = {}
): Promise<Map<string, string>> {
  if (isLocalMode()) return fetchLocalBodies(noteIds)
  const bodies = new Map<string, string>()
  if (!db) return bodies
  const database = db
  let done = 0

  for (let start = 0; start < noteIds.length; start += concurrency) {
    const slice = noteIds.slice(start, start + concurrency)
    await Promise.all(
      slice.map(async (noteId) => {
        try {
          const snap = await getDoc(doc(database, 'notes', noteId, 'body', 'main'))
          if (snap.exists()) {
            bodies.set(noteId, (snap.data().markdown as string) ?? '')
            return
          }
          const noteSnap = await getDoc(doc(database, 'notes', noteId))
          bodies.set(noteId, (noteSnap.data()?.markdown as string) ?? '')
        } catch {
          bodies.set(noteId, '')
        }
      })
    )
    done += slice.length
    onProgress?.(done)
  }
  return bodies
}

// ---------- notes ----------

/**
 * Client-side id for a note that does not exist yet: lets the tab open on the
 * first frame while Firestore creates the document in the background.
 */
export function reserveNoteId(): string | null {
  if (isLocalMode()) return reserveLocalNoteId()
  if (!db) return null
  return doc(collection(db, 'notes')).id
}

/**
 * The note a tab shows before its document exists.
 *
 * Creating a note is one round trip; without this draft the tab stays empty for
 * that whole time (and for the body subscription after it). The draft has
 * exactly the fields `createNote` writes, so the swap from draft to stored note
 * is invisible.
 */
export function newNoteDraft(
  uid: string,
  folder: Folder | null | undefined,
  id: string,
  kind: NoteKind = 'note'
): Note {
  const acl: Acl = folder
    ? { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
    : { memberIds: [uid], roles: { [uid]: 'owner' }, access: 'restricted' }
  return {
    id,
    ownerId: uid,
    folderId: folder ? folder.id : null,
    aclSource: folder ? 'folder' : 'own',
    ...acl,
    kind,
    // A new note is nameless: the pane shows "Untitled" as its placeholder, and a
    // note nobody ever names keeps an empty title instead of storing that word.
    title: '',
    markdown: '',
    tags: [],
    order: 0,
    version: 1,
  }
}

export async function createNote(
  uid: string,
  folder?: Folder,
  id?: string,
  kind: NoteKind = 'note'
): Promise<Note> {
  if (isLocalMode()) return createLocalNote(uid, folder, id, kind)
  if (!db) throw new Error(t('error.firebaseNotConfigured'))
  const ref = id ? doc(db, 'notes', id) : doc(collection(db, 'notes'))
  const now = serverTimestamp()
  const acl: Acl = folder
    ? { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
    : { memberIds: [uid], roles: { [uid]: 'owner' }, access: 'restricted' }

  const body = kind === 'canvas' ? EMPTY_CANVAS_JSON : ''
  const batch = writeBatch(db)
  batch.set(ref, {
    ownerId: uid,
    folderId: folder ? folder.id : null,
    aclSource: folder ? 'folder' : 'own',
    ...(kind === 'canvas' ? { kind } : {}),
    ...acl,
    title: '',
    markdownBytes: body.length,
    tags: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  // An empty body document from the start, so every note has the same shape
  // (a canvas starts from the empty JSON Canvas file instead of nothing).
  batch.set(doc(ref, 'body', 'main'), bodyDocument(body, 1))
  await batch.commit()

  return newNoteDraft(uid, folder, ref.id, kind)
}

/** An edit made before the note document existed, waiting for it. */
export interface DeferredWrite {
  patch: { title?: string; markdown?: string; tags?: string[] }
  /** The body limit of the last write (a canvas allows more than markdown). */
  maxChars: number
}

/**
 * Merges an edit into the queue, last value per field. A rename followed by a
 * canvas edit must keep both: replacing the queue would lose the title.
 */
export function mergeDeferred(
  previous: DeferredWrite | null,
  patch: DeferredWrite['patch'],
  maxChars: number
): DeferredWrite {
  return { patch: { ...(previous?.patch ?? {}), ...patch }, maxChars }
}

/**
 * Partial update: only the fields present in the patch are written.
 *
 * This used to always write `title`, defaulting to an empty string, so saving
 * markdown (which does not carry the title) wiped the note's title on every
 * save — one second after opening it.
 */
/**
 * Metadata patch for a note. Only the fields present end up in the write; the
 * body never travels in this document (see `bodyDocument`).
 */
export function buildNoteUpdate(patch: {
  title?: string
  tags?: string[]
  version?: number
  markdownBytes?: number
}): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title.slice(0, MAX_TITLE_LENGTH)
  if (patch.tags !== undefined) update.tags = patch.tags
  if (patch.version !== undefined) update.version = patch.version
  if (patch.markdownBytes !== undefined) update.markdownBytes = patch.markdownBytes
  return update
}

/**
 * The note body document: what an editor reads and writes.
 *
 * `maxChars` exists because a canvas that gets sliced is not a short canvas, it
 * is an unparseable one: the caller passes the canvas limit and refuses the
 * write instead of truncating JSON.
 */
export function bodyDocument(
  markdown: string,
  version = 0,
  maxChars = MAX_MARKDOWN_BYTES
): Record<string, unknown> {
  const text = markdown.slice(0, maxChars)
  return { markdown: text, bytes: text.length, version, updatedAt: serverTimestamp() }
}

export interface NewNoteInput {
  title: string
  markdown: string
  tags: string[]
  folder: Folder | null
  order?: number
  /** `canvas` notes store a JSON Canvas document in `markdown`. */
  kind?: NoteKind
}

/**
 * Document data for a note created with its content already in place.
 *
 * The import path used to create an empty note and then send a second write for
 * its markdown: two round trips per note, 1.000 of them for a 500-note vault.
 * The create rule accepts everything in one document (it only asks that
 * `createdAt` and `updatedAt` be the same server timestamp), so one write is
 * enough.
 */
export function buildNoteDocument(
  uid: string,
  input: NewNoteInput,
  now: ReturnType<typeof serverTimestamp>
): Record<string, unknown> {
  const acl: Acl = input.folder
    ? { memberIds: input.folder.memberIds, roles: input.folder.roles, access: input.folder.access }
    : { memberIds: [uid], roles: { [uid]: 'owner' }, access: 'restricted' }

  return {
    ownerId: uid,
    folderId: input.folder ? input.folder.id : null,
    aclSource: input.folder ? 'folder' : 'own',
    ...acl,
    // No invented title: an imported note keeps the name its file gave it, and an
    // empty one is a nameless note, not a note called "Untitled".
    title: input.title.slice(0, MAX_TITLE_LENGTH),
    ...(input.kind === 'canvas' ? { kind: 'canvas' as const } : {}),
    markdownBytes: Math.min(input.markdown.length, MAX_MARKDOWN_BYTES),
    tags: input.tags,
    order: input.order ?? 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

const IMPORT_CHUNK = 50

/**
 * Creates many notes with one write each, committed in chunks.
 *
 * Chunks keep the batch under Firestore's 500-operation limit and give failures
 * a useful granularity: a failing chunk is retried note by note, so one bad note
 * does not lose the other 49.
 */
export async function importNotes(
  uid: string,
  notes: NewNoteInput[],
  { onProgress }: { onProgress?: (written: number) => void } = {}
): Promise<{ created: string[]; failed: number }> {
  if (isLocalMode()) return importLocalNotes(uid, notes)
  if (!db) throw new Error(t('error.firebaseNotConfigured'))
  const database = db
  const created: string[] = []
  let failed = 0

  for (let start = 0; start < notes.length; start += IMPORT_CHUNK) {
    const chunk = notes.slice(start, start + IMPORT_CHUNK)
    const batch = writeBatch(database)
    const refs = chunk.map((input) => {
      const ref = doc(collection(database, 'notes'))
      batch.set(ref, buildNoteDocument(uid, input, serverTimestamp()))
      batch.set(
        doc(ref, 'body', 'main'),
        bodyDocument(input.markdown, 1, input.kind === 'canvas' ? MAX_CANVAS_CHARS : MAX_MARKDOWN_BYTES)
      )
      return ref
    })

    try {
      await batch.commit()
      created.push(...refs.map((ref) => ref.id))
    } catch {
      // One bad note fails the whole batch: retry them one at a time to keep the
      // rest of the chunk.
      for (let i = 0; i < chunk.length; i++) {
        try {
          const noteBatch = writeBatch(database)
          noteBatch.set(refs[i], buildNoteDocument(uid, chunk[i], serverTimestamp()))
          noteBatch.set(
            doc(refs[i], 'body', 'main'),
            bodyDocument(
              chunk[i].markdown,
              1,
              chunk[i].kind === 'canvas' ? MAX_CANVAS_CHARS : MAX_MARKDOWN_BYTES
            )
          )
          await noteBatch.commit()
          created.push(refs[i].id)
        } catch {
          failed++
        }
      }
    }
    onProgress?.(created.length + failed)
  }

  return { created, failed }
}

/**
 * Saves a note: the body goes to `notes/{id}/body/main`, the rest stays on the
 * note document, and both land in one commit (one round trip, no half-saved
 * note).
 */
export async function saveNoteContent(
  noteId: string,
  patch: {
    title?: string
    markdown?: string
    tags?: string[]
    version?: number
    /** Canvas notes pass the larger body limit; markdown keeps 250.000 chars. */
    maxChars?: number
  }
): Promise<void> {
  if (isLocalMode()) return saveLocalNoteContent(noteId, patch)
  // El texto va por el proxy, que cobra la escritura en la misma transacción.
  // Sin proxy configurado se mantiene la escritura directa (desarrollo).
  const markdown = patch.markdown
  if (proxyEnabled && markdown !== undefined) {
    await postBody(noteId, { ...patch, markdown })
    return
  }
  if (!db) return
  const database = db
  const batch = writeBatch(database)
  const metadata: Record<string, unknown> = {
    ...buildNoteUpdate({
      title: patch.title,
      tags: patch.tags,
      version: patch.version,
      markdownBytes: patch.markdown?.length,
    }),
    updatedAt: serverTimestamp(),
  }
  if (patch.markdown !== undefined) {
    batch.set(
      bodyRef(noteId),
      bodyDocument(patch.markdown, patch.version ?? 0, patch.maxChars ?? MAX_MARKDOWN_BYTES),
      { merge: true }
    )
    // Notes written before the split carried the text inline: once it is in the
    // body document, drop it from here (the list stops downloading it).
    metadata.markdown = deleteField()
  }
  batch.update(doc(database, 'notes', noteId), metadata)
  await batch.commit()
}

/**
 * Move a note into a folder (inheriting its ACL) or back to the root, where it
 * becomes private to its owner again.
 */
export async function moveNoteTo(note: Note, target: Folder | null): Promise<void> {
  if (isLocalMode()) return moveLocalNoteTo(note, target)
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
  if (isLocalMode()) return deleteLocalNote(noteId)
  if (!db) return
  const database = db
  // The note goes first: it is what grants access to the body. If the second
  // delete fails, what is left is an unreachable orphan, not a resurrected note
  // with an empty body — which is what deleting the body first would produce.
  await deleteDoc(doc(database, 'notes', noteId))
  await deleteDoc(doc(database, 'notes', noteId, 'body', 'main')).catch(() => undefined)
}

// ---------- folders ----------

export function cleanFolderName(name: string): string {
  return name.trim().slice(0, MAX_FOLDER_NAME) || t('app.folderName')
}

/**
 * Client-side id for a folder that does not exist yet, like `reserveNoteId`:
 * the row shows up in the first frame and the document catches up.
 */
export function reserveFolderId(): string | null {
  if (isLocalMode()) return reserveLocalFolderId()
  if (!db) return null
  return doc(collection(db, 'folders')).id
}

/** Exactly what `createFolder` writes, without the round trip. */
export function optimisticFolder(
  uid: string,
  id: string,
  name: string,
  parentId: string | null,
  options: { sort?: SortMode; order?: number } = {}
): Folder {
  return {
    id,
    ownerId: uid,
    name: cleanFolderName(name),
    parentId,
    sort: options.sort ?? DEFAULT_SORT,
    order: options.order ?? 0,
    tags: [],
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
  }
}

export async function createFolder(
  uid: string,
  name: string,
  parentId: string | null = null,
  tags: string[] = [],
  options: { sort?: SortMode; order?: number } = {},
  id?: string
): Promise<Folder> {
  if (isLocalMode()) return createLocalFolder(uid, name, parentId, tags, options, id)
  if (!db) throw new Error(t('error.firebaseNotConfigured'))
  const ref = id ? doc(db, 'folders', id) : doc(collection(db, 'folders'))
  const now = serverTimestamp()
  const clean = cleanFolderName(name)
  await setDoc(ref, {
    ownerId: uid,
    name: clean,
    parentId,
    // A folder created inside another one inherits its ordering.
    sort: options.sort ?? DEFAULT_SORT,
    order: options.order ?? 0,
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
    sort: options.sort ?? DEFAULT_SORT,
    order: options.order ?? 0,
    tags,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
  }
}

export async function setFolderSort(folderId: string, sort: SortMode): Promise<void> {
  if (isLocalMode()) return setLocalFolderSort(folderId, sort)
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { sort, updatedAt: serverTimestamp() })
}

export interface UserSettings {
  rootSort: SortMode
}

export function subscribeUserSettings(
  uid: string,
  onChange: (settings: UserSettings) => void
): () => void {
  if (isLocalMode()) return subscribeLocalSettings(onChange)
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'settings', uid),
    (snap) => {
      const sort = snap.data()?.rootSort
      onChange({ rootSort: (sort as SortMode) ?? DEFAULT_SORT })
    },
    () => onChange({ rootSort: DEFAULT_SORT })
  )
}

export async function setRootSort(uid: string, rootSort: SortMode): Promise<void> {
  if (isLocalMode()) return setLocalRootSort(rootSort)
  if (!db) return
  await setDoc(
    doc(db, 'settings', uid),
    { rootSort, updatedAt: serverTimestamp() },
    { merge: true }
  )
}

/** How many writes fit in one commit (Firestore rejects more than 500). */
const BATCH_LIMIT = 400

/**
 * Persists the order changes of a manual move.
 *
 * Chunked: a renumber writes every sibling, and a folder with more than 500 of
 * them used to throw (`maximum 500 writes allowed per request`).
 */
export async function applyOrder(
  collection: 'folders' | 'notes',
  pairs: Array<{ id: string; order: number }>
): Promise<void> {
  if (isLocalMode()) return applyLocalOrder(collection, pairs)
  if (!db) return
  const database = db
  for (let start = 0; start < pairs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(database)
    pairs.slice(start, start + BATCH_LIMIT).forEach(({ id, order }) => {
      batch.update(doc(database, collection, id), { order, updatedAt: serverTimestamp() })
    })
    await batch.commit()
  }
}

export async function moveFolder(folderId: string, parentId: string | null): Promise<void> {
  if (isLocalMode()) return moveLocalFolder(folderId, parentId)
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { parentId, updatedAt: serverTimestamp() })
}

export async function updateFolderTags(folderId: string, tags: string[]): Promise<void> {
  if (isLocalMode()) return updateLocalFolderTags(folderId, tags)
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { tags, updatedAt: serverTimestamp() })
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  if (isLocalMode()) return renameLocalFolder(folderId, name)
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), {
    name: name.trim().slice(0, MAX_FOLDER_NAME) || t('app.folderName'),
    updatedAt: serverTimestamp(),
  })
}

export async function setFolderAccess(folderId: string, access: Access): Promise<void> {
  if (!db) return
  await updateDoc(doc(db, 'folders', folderId), { access, updatedAt: serverTimestamp() })
}

/** Remove the folder, moving its notes back to the root first. */
export async function deleteFolder(folderId: string): Promise<void> {
  if (isLocalMode()) return deleteLocalFolder(folderId)
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
  // A visitor's workspace has no one to share with: the ACL stays local.
  if (isLocalMode()) return
  if (!db) return
  if (note.aclSource === 'folder') {
    throw new Error(t('error.folderInheritedAcl'))
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
  // A visitor's workspace has no one to share with: the ACL stays local.
  if (isLocalMode()) return
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
  if (isLocalMode()) return getLocalFolder(folderId)
  if (!db) return null
  const snap = await getDoc(doc(db, 'folders', folderId))
  return snap.exists() ? toFolder(snap.id, snap.data()) : null
}

// ---------- migration ----------

const MIGRATION_FLAG = 'firemd-migrated-v2'

/**
 * One-time move of bodies that still live inside the note document.
 *
 * The workspace list is the only thing that still receives them, so it is also
 * what feeds this: each note gets its `body/main` document and loses the inline
 * field in the same commit. A failed note is left untouched and still readable
 * through the fallback, so a half-finished migration loses nothing.
 */
export async function migrateNoteBodies(
  notes: Note[],
  { onProgress, chunkSize = 20 }: { onProgress?: (done: number) => void; chunkSize?: number } = {}
): Promise<{ migrated: string[]; failed: string[] }> {
  if (!db) return { migrated: [], failed: [] }
  const database = db
  const legacy = notes.filter((note) => (note.markdown ?? '') !== '' && note.markdownBytes === undefined)
  const migrated: string[] = []
  const failed: string[] = []

  for (let start = 0; start < legacy.length; start += chunkSize) {
    const chunk = legacy.slice(start, start + chunkSize)
    const batch = writeBatch(database)
    chunk.forEach((note) => {
      batch.set(doc(database, 'notes', note.id, 'body', 'main'), bodyDocument(note.markdown, note.version))
      batch.update(doc(database, 'notes', note.id), {
        markdown: deleteField(),
        markdownBytes: note.markdown.length,
      })
    })
    try {
      await batch.commit()
      migrated.push(...chunk.map((note) => note.id))
    } catch {
      // Try them one by one so a single rejection does not stall the rest.
      for (const note of chunk) {
        try {
          const single = writeBatch(database)
          single.set(doc(database, 'notes', note.id, 'body', 'main'), bodyDocument(note.markdown, note.version))
          single.update(doc(database, 'notes', note.id), {
            markdown: deleteField(),
            markdownBytes: note.markdown.length,
          })
          await single.commit()
          migrated.push(note.id)
        } catch {
          // Leave it inline: the fallback keeps working, and the caller decides
          // whether to try again (a permission error is not worth a retry storm).
          failed.push(note.id)
        }
      }
    }
    onProgress?.(migrated.length)
  }

  return { migrated, failed }
}

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
      const body = String(data.content ?? '').slice(0, MAX_MARKDOWN_BYTES)
      const batch = writeBatch(db!)
      batch.set(target, {
        ownerId: uid,
        folderId: null,
        aclSource: 'own',
        memberIds: [uid],
        roles: { [uid]: 'owner' },
        access: 'restricted',
        title: String(data.title ?? '').slice(0, MAX_TITLE_LENGTH),
        markdownBytes: body.length,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      batch.set(doc(target, 'body', 'main'), bodyDocument(body, 1))
      await batch.commit()
      await deleteDoc(legacyDoc.ref)
      migrated++
    } catch {
      // Keep the legacy document when the copy fails.
    }
  }
  return migrated
}

export { MIGRATION_FLAG }
