import type { Folder, NewNoteInput, Note, NoteKind } from './notes'
import type { SortMode } from './sorting'

/**
 * The visitor's workspace: the same notes and folders the app shows a signed-in
 * user, kept in `localStorage` instead of Firestore.
 *
 * Why a real store and not a single draft: the first screen has to be the same
 * editor as the authenticated one — sidebar, folders, tabs, panes — or the
 * product looks like a different app. A guest who writes three notes in two
 * folders expects them to survive a reload, and expects the same gestures.
 *
 * The store is deliberately small: it holds the same shapes the UI already
 * reads, and the persistence functions in `notes.ts` dispatch here when
 * `isLocalMode()` is on. On sign-in, `migrateLocalStore` copies everything to
 * Firestore and clears the local copy.
 */

export const LOCAL_UID = 'local'
export const LOCAL_STORE_KEY = 'firemd-local-store'
export const LOCAL_ROOT_SORT_KEY = 'firemd-local-root-sort'

/** A note as this store keeps it: metadata plus the body text. */
interface LocalData {
  notes: Note[]
  folders: Folder[]
  bodies: Record<string, string>
}

let localMode = false

/** True while the app is showing the visitor's workspace. */
export function isLocalMode(): boolean {
  return localMode
}

export function setLocalMode(on: boolean): void {
  localMode = on
}

/* ------------------------------------------------------------------ storage */

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * A fresh empty store. A factory, not a shared constant: `read()` used to return
 * `{ ...EMPTY }`, and a shallow copy shares the `notes`/`folders` arrays, so the
 * first write polluted the "empty" value and `clearLocalStore()` stopped
 * clearing anything in memory.
 */
function empty(): LocalData {
  return { notes: [], folders: [], bodies: {} }
}

function read(store: Storage | null = defaultStorage()): LocalData {
  if (!store) return empty()
  try {
    const raw = store.getItem(LOCAL_STORE_KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<LocalData>
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      bodies: parsed.bodies && typeof parsed.bodies === 'object' ? parsed.bodies : {},
    }
  } catch {
    return empty()
  }
}

function write(data: LocalData, store: Storage | null = defaultStorage()): void {
  if (!store) return
  try {
    store.setItem(LOCAL_STORE_KEY, JSON.stringify(data))
  } catch {
    // Quota exceeded or private mode: the in-memory copy still works this
    // session. Losing the draft is worse than a silent no-op here.
  }
}

/* -------------------------------------------------------------- pub/sub */

type Listener = () => void
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test seam: forget the in-memory subscribers between tests. */
export function resetLocalStoreForTests(): void {
  listeners.clear()
}

/* --------------------------------------------------------------- helpers */

function nowSeconds(): { seconds: number } {
  return { seconds: Math.floor(Date.now() / 1000) }
}

function aclFor(uid: string, folder: Folder | null | undefined) {
  return folder
    ? { memberIds: folder.memberIds, roles: folder.roles, access: folder.access }
    : { memberIds: [uid], roles: { [uid]: 'owner' as const }, access: 'restricted' as const }
}

function buildNote(
  uid: string,
  folder: Folder | null | undefined,
  id: string,
  kind: NoteKind,
  title: string,
  markdown: string
): Note {
  const acl = aclFor(uid, folder)
  return {
    id,
    ownerId: uid,
    folderId: folder ? folder.id : null,
    aclSource: folder ? 'folder' : 'own',
    ...acl,
    kind,
    title,
    markdown: '',
    markdownBytes: markdown.length,
    tags: [],
    order: 0,
    version: 1,
    createdAt: nowSeconds(),
    updatedAt: nowSeconds(),
  }
}

function newId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${suffix}`
}

/* ------------------------------------------------------------ notes: read */

export function subscribeLocalNotes(
  _uid: string,
  onChange: (notes: Note[]) => void
): () => void {
  const emit = () => onChange(read().notes.slice().sort(byUpdatedAt))
  emit()
  return subscribe(emit)
}

export function subscribeLocalFolders(
  _uid: string,
  onChange: (folders: Folder[]) => void
): () => void {
  const emit = () => onChange(read().folders.slice().sort((a, b) => a.name.localeCompare(b.name)))
  emit()
  return subscribe(emit)
}

export function subscribeLocalNote(noteId: string, onChange: (note: Note | null) => void): () => void {
  const emit = () => onChange(read().notes.find((note) => note.id === noteId) ?? null)
  emit()
  return subscribe(emit)
}

export function subscribeLocalBody(noteId: string, onChange: (body: string | null) => void): () => void {
  const emit = () => {
    const data = read()
    const exists = data.notes.some((note) => note.id === noteId)
    onChange(exists ? (data.bodies[noteId] ?? '') : null)
  }
  emit()
  return subscribe(emit)
}

export async function fetchLocalBodies(noteIds: string[]): Promise<Map<string, string>> {
  const data = read()
  const bodies = new Map<string, string>()
  noteIds.forEach((id) => bodies.set(id, data.bodies[id] ?? ''))
  return bodies
}

export function getLocalNote(noteId: string): Note | null {
  return read().notes.find((note) => note.id === noteId) ?? null
}

export function getLocalFolder(folderId: string): Folder | null {
  return read().folders.find((folder) => folder.id === folderId) ?? null
}

function byUpdatedAt(a: Note, b: Note): number {
  return (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0)
}

/* ----------------------------------------------------------- notes: write */

export function reserveLocalNoteId(): string {
  return newId('note')
}

export function newLocalNoteDraft(
  uid: string,
  folder: Folder | null | undefined,
  id: string,
  kind: NoteKind = 'note'
): Note {
  const title = kind === 'canvas' ? 'Canvas sin título' : 'Sin título'
  return buildNote(uid, folder, id, kind, title, '')
}

export async function createLocalNote(
  uid: string,
  folder?: Folder,
  id?: string,
  kind: NoteKind = 'note'
): Promise<Note> {
  const data = read()
  const noteId = id ?? newId('note')
  const note = buildNote(uid, folder, noteId, kind, kind === 'canvas' ? 'Canvas sin título' : 'Sin título', '')
  const body = kind === 'canvas' ? EMPTY_CANVAS : ''
  data.notes.push(note)
  data.bodies[noteId] = body
  write(data)
  notify()
  return note
}

export async function saveLocalNoteContent(
  noteId: string,
  patch: {
    title?: string
    markdown?: string
    tags?: string[]
    version?: number
    maxChars?: number
  }
): Promise<void> {
  const data = read()
  const index = data.notes.findIndex((note) => note.id === noteId)
  if (index === -1) return
  const note = data.notes[index]
  const markdown = patch.markdown
  if (markdown !== undefined) {
    const text = markdown.slice(0, patch.maxChars ?? MAX_LOCAL_MARKDOWN)
    data.bodies[noteId] = text
    note.markdownBytes = text.length
  }
  data.notes[index] = {
    ...note,
    title: patch.title !== undefined ? patch.title.slice(0, 300) : note.title,
    tags: patch.tags !== undefined ? patch.tags : note.tags,
    version: patch.version !== undefined ? patch.version : note.version,
    updatedAt: nowSeconds(),
  }
  write(data)
  notify()
}

export async function moveLocalNoteTo(note: Note, target: Folder | null): Promise<void> {
  const data = read()
  const index = data.notes.findIndex((item) => item.id === note.id)
  if (index === -1) return
  const acl = aclFor(note.ownerId, target)
  data.notes[index] = {
    ...data.notes[index],
    folderId: target ? target.id : null,
    aclSource: target ? 'folder' : 'own',
    ...acl,
    updatedAt: nowSeconds(),
  }
  write(data)
  notify()
}

export async function deleteLocalNote(noteId: string): Promise<void> {
  const data = read()
  data.notes = data.notes.filter((note) => note.id !== noteId)
  delete data.bodies[noteId]
  write(data)
  notify()
}

/* -------------------------------------------------------- folders: write */

export function reserveLocalFolderId(): string {
  return newId('folder')
}

export function newLocalFolder(
  uid: string,
  id: string,
  name: string,
  parentId: string | null,
  tags: string[] = [],
  options: { sort?: SortMode; order?: number } = {}
): Folder {
  return {
    id,
    ownerId: uid,
    name: name.trim().slice(0, 120) || 'Carpeta',
    parentId,
    sort: options.sort ?? 'manual',
    order: options.order ?? 0,
    tags,
    memberIds: [uid],
    roles: { [uid]: 'owner' },
    access: 'restricted',
    createdAt: nowSeconds(),
    updatedAt: nowSeconds(),
  }
}

export async function createLocalFolder(
  uid: string,
  name: string,
  parentId: string | null = null,
  tags: string[] = [],
  options: { sort?: SortMode; order?: number } = {},
  id?: string
): Promise<Folder> {
  const data = read()
  const folder = newLocalFolder(uid, id ?? newId('folder'), name, parentId, tags, options)
  data.folders.push(folder)
  write(data)
  notify()
  return folder
}

export async function renameLocalFolder(folderId: string, name: string): Promise<void> {
  const data = read()
  const index = data.folders.findIndex((folder) => folder.id === folderId)
  if (index === -1) return
  data.folders[index] = {
    ...data.folders[index],
    name: name.trim().slice(0, 120) || 'Carpeta',
    updatedAt: nowSeconds(),
  }
  write(data)
  notify()
}

export async function deleteLocalFolder(folderId: string): Promise<void> {
  const data = read()
  // Notes in the folder go back to the root, as the Firestore delete does.
  data.notes = data.notes.map((note) =>
    note.folderId === folderId ? { ...note, folderId: null, aclSource: 'own' as const } : note
  )
  data.folders = data.folders.filter((folder) => folder.id !== folderId)
  write(data)
  notify()
}

export async function moveLocalFolder(folderId: string, parentId: string | null): Promise<void> {
  const data = read()
  const index = data.folders.findIndex((folder) => folder.id === folderId)
  if (index === -1) return
  data.folders[index] = { ...data.folders[index], parentId, updatedAt: nowSeconds() }
  write(data)
  notify()
}

export async function updateLocalFolderTags(folderId: string, tags: string[]): Promise<void> {
  const data = read()
  const index = data.folders.findIndex((folder) => folder.id === folderId)
  if (index === -1) return
  data.folders[index] = { ...data.folders[index], tags, updatedAt: nowSeconds() }
  write(data)
  notify()
}

export async function setLocalFolderSort(folderId: string, sort: SortMode): Promise<void> {
  const data = read()
  const index = data.folders.findIndex((folder) => folder.id === folderId)
  if (index === -1) return
  data.folders[index] = { ...data.folders[index], sort, updatedAt: nowSeconds() }
  write(data)
  notify()
}

export async function applyLocalOrder(
  collection: 'folders' | 'notes',
  pairs: Array<{ id: string; order: number }>
): Promise<void> {
  const data = read()
  const list = collection === 'folders' ? data.folders : data.notes
  pairs.forEach(({ id, order }) => {
    const index = list.findIndex((item) => item.id === id)
    if (index !== -1) list[index] = { ...list[index], order, updatedAt: nowSeconds() }
  })
  write(data)
  notify()
}

/* ------------------------------------------------------------- settings */

export function subscribeLocalSettings(onChange: (settings: { rootSort: SortMode }) => void): () => void {
  const emit = () => {
    const store = defaultStorage()
    const sort = store?.getItem(LOCAL_ROOT_SORT_KEY) as SortMode | null
    onChange({ rootSort: sort ?? 'manual' })
  }
  emit()
  return subscribe(emit)
}

export async function setLocalRootSort(rootSort: SortMode): Promise<void> {
  const store = defaultStorage()
  try {
    store?.setItem(LOCAL_ROOT_SORT_KEY, rootSort)
  } catch {
    // Same as the store: a lost preference is not worth failing the gesture.
  }
  notify()
}

/* --------------------------------------------------------------- import */

export async function importLocalNotes(
  uid: string,
  inputs: NewNoteInput[]
): Promise<{ created: string[]; failed: number }> {
  const data = read()
  const created: string[] = []
  inputs.forEach((input) => {
    const id = newId('note')
    const note = buildNote(uid, input.folder, id, input.kind ?? 'note', input.title, input.markdown)
    note.tags = input.tags ?? []
    note.order = input.order ?? 0
    data.notes.push(note)
    data.bodies[id] = input.markdown
    created.push(id)
  })
  write(data)
  notify()
  return { created, failed: 0 }
}

/* ------------------------------------------------------------- migration */

export interface LocalMigrationResult {
  notes: number
  folders: number
}

/**
 * Copies everything the visitor wrote to Firestore and clears the local copy.
 *
 * Folders go first: a note created inside a folder inherits its ACL, and the
 * folder document must exist for that. The local copy is cleared only after the
 * whole copy succeeds, so a failed migration leaves the draft intact.
 */
export async function migrateLocalStore(
  uid: string,
  deps: {
    createFolder: (uid: string, name: string, parentId: string | null, tags: string[], options: { sort?: SortMode; order?: number }, id?: string) => Promise<Folder>
    createNote: (uid: string, folder?: Folder, id?: string, kind?: NoteKind) => Promise<Note>
    saveNoteContent: (noteId: string, patch: { title?: string; markdown?: string; tags?: string[]; version?: number }) => Promise<void>
  }
): Promise<LocalMigrationResult> {
  const data = read()
  const folderMap = new Map<string, Folder>()
  let folders = 0
  let notes = 0

  // Parents before children: a folder's parentId must already exist.
  const pending = data.folders.slice()
  while (pending.length > 0) {
    const index = pending.findIndex((folder) => folder.parentId === null || folderMap.has(folder.parentId))
    if (index === -1) break
    const folder = pending.splice(index, 1)[0]
    const parent = folder.parentId ? folderMap.get(folder.parentId) ?? null : null
    const created = await deps.createFolder(uid, folder.name, parent ? parent.id : null, folder.tags, {
      sort: folder.sort,
      order: folder.order,
    })
    folderMap.set(folder.id, created)
    folders += 1
  }

  for (const note of data.notes) {
    const folder = note.folderId ? folderMap.get(note.folderId) ?? null : null
    const created = await deps.createNote(uid, folder ?? undefined, undefined, note.kind)
    await deps.saveNoteContent(created.id, {
      title: note.title,
      markdown: data.bodies[note.id] ?? '',
      tags: note.tags,
      version: 1,
    })
    notes += 1
  }

  clearLocalStore()
  return { notes, folders }
}

export function clearLocalStore(): void {
  const store = defaultStorage()
  try {
    store?.removeItem(LOCAL_STORE_KEY)
    store?.removeItem(LOCAL_ROOT_SORT_KEY)
  } catch {
    // Nothing to clear.
  }
  notify()
}

/** How many notes and folders the visitor has, for the sign-in CTA. */
export function localStoreSummary(): { notes: number; folders: number } {
  const data = read()
  return { notes: data.notes.length, folders: data.folders.length }
}

const EMPTY_CANVAS = '{"nodes":[],"edges":[]}'
const MAX_LOCAL_MARKDOWN = 250_000
