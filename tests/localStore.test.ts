// @vitest-environment jsdom
/**
 * The visitor's workspace lives in `localStorage`: the same notes and folders
 * shapes the signed-in app reads, so the first screen is the real editor with a
 * local transport instead of a cut-down one. These tests pin the contract the
 * shell depends on: subscribe, create, save, and the one-way migration to
 * Firestore on sign-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_STORE_KEY,
  LOCAL_UID,
  clearLocalStore,
  createLocalFolder,
  WELCOME_NOTE_ID,
  createLocalNote,
  deleteLocalNote,
  getLocalNote,
  seedLocalNote,
  isLocalMode,
  localStoreSummary,
  migrateLocalStore,
  resetLocalStoreForTests,
  saveLocalNoteContent,
  setLocalMode,
  subscribeLocalBody,
  subscribeLocalFolders,
  subscribeLocalNotes,
} from '../src/lib/localStore'

beforeEach(() => {
  localStorage.clear()
  resetLocalStoreForTests()
  setLocalMode(true)
})

describe('local workspace', () => {
  it('starts empty and reports a zero summary', () => {
    expect(localStoreSummary()).toEqual({ notes: 0, folders: 0 })
  })

  it('creates a note and notifies subscribers', () => {
    const seen: number[] = []
    const off = subscribeLocalNotes(LOCAL_UID, (notes) => seen.push(notes.length))

    return createLocalNote(LOCAL_UID).then((note) => {
      expect(note.ownerId).toBe(LOCAL_UID)
      // Nameless: the sidebar and the pane show "Untitled" as a placeholder.
      expect(note.title).toBe('')
      expect(seen).toEqual([0, 1])
      expect(localStoreSummary().notes).toBe(1)
      off()
    })
  })

  it('saves the body and the title, and the body subscription sees it', async () => {
    const note = await createLocalNote(LOCAL_UID)
    const bodies: (string | null)[] = []
    const off = subscribeLocalBody(note.id, (body) => bodies.push(body))

    await saveLocalNoteContent(note.id, { title: 'Hola', markdown: '# Hola' })

    expect(bodies).toEqual(['', '# Hola'])
    expect(localStoreSummary().notes).toBe(1)
    off()
  })

  it('keeps a folder and its notes across a reload', async () => {
    const folder = await createLocalFolder(LOCAL_UID, 'Proyecto', null, [], { sort: 'manual', order: 0 })
    await createLocalNote(LOCAL_UID, folder)

    const folders: string[] = []
    const off = subscribeLocalFolders(LOCAL_UID, (list) => folders.push(...list.map((f) => f.name)))

    expect(folders).toContain('Proyecto')
    expect(localStoreSummary()).toEqual({ notes: 1, folders: 1 })
    off()
  })

  it('deletes a note and its body', async () => {
    const note = await createLocalNote(LOCAL_UID)
    await deleteLocalNote(note.id)
    expect(localStoreSummary().notes).toBe(0)
    expect(localStorage.getItem(LOCAL_STORE_KEY)).not.toContain(note.id)
  })

  it('seeds the tour note under its fixed id, once', () => {
    const first = seedLocalNote(LOCAL_UID, WELCOME_NOTE_ID, 'Welcome to FireMD', 'Hola')
    expect(first?.id).toBe(WELCOME_NOTE_ID)
    expect(getLocalNote(WELCOME_NOTE_ID)?.title).toBe('Welcome to FireMD')
    expect(localStoreSummary().notes).toBe(1)

    // A reload asks again: the note is already here, so nothing is written and
    // nothing is refilled over whatever the visitor did to it.
    const second = seedLocalNote(LOCAL_UID, WELCOME_NOTE_ID, 'Welcome to FireMD', 'Otro texto')
    expect(second).toBeNull()
    expect(localStoreSummary().notes).toBe(1)
    expect(getLocalNote(WELCOME_NOTE_ID)?.title).toBe('Welcome to FireMD')
  })

  it('keeps the tour deleted once the visitor deletes it', () => {
    seedLocalNote(LOCAL_UID, WELCOME_NOTE_ID, 'Welcome to FireMD', 'Hola')
    void deleteLocalNote(WELCOME_NOTE_ID)

    // The next reload must not resurrect it, even though the store is empty:
    // that is what "seeded once" means. The shell seeds the empty note too, so
    // in practice the store is not empty at this point.
    expect(seedLocalNote(LOCAL_UID, WELCOME_NOTE_ID, 'Welcome to FireMD', 'Hola')).toBeNull()
    expect(localStoreSummary().notes).toBe(0)
  })

  it('treats a supplied id as an identity, not a slot', async () => {
    const first = await createLocalNote(LOCAL_UID, undefined, 'note-fixed')
    const second = await createLocalNote(LOCAL_UID, undefined, 'note-fixed')
    expect(second.id).toBe(first.id)
    expect(localStoreSummary().notes).toBe(1)
  })

  it('reports the mode it is in', () => {
    expect(isLocalMode()).toBe(true)
    setLocalMode(false)
    expect(isLocalMode()).toBe(false)
    setLocalMode(true)
  })
})

describe('migration to Firestore', () => {
  it('copies folders and notes, then clears the local copy', async () => {
    const folder = await createLocalFolder(LOCAL_UID, 'Proyecto', null, [], { sort: 'manual', order: 0 })
    const note = await createLocalNote(LOCAL_UID, folder)
    await saveLocalNoteContent(note.id, { title: 'Hola', markdown: '# Hola' })

    const createFolder = vi.fn(async (_uid: string, name: string) => ({
      ...folder,
      id: 'folder-remote',
      name,
    }))
    const createNote = vi.fn(async (_uid: string) => ({ ...note, id: 'note-remote' }))
    const saveNoteContent = vi.fn(async () => undefined)

    const result = await migrateLocalStore('user-1', {
      createFolder: createFolder as never,
      createNote: createNote as never,
      saveNoteContent: saveNoteContent as never,
    })

    expect(result).toEqual({ notes: 1, folders: 1 })
    expect(createFolder).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledTimes(1)
    expect(saveNoteContent).toHaveBeenCalledWith('note-remote', {
      title: 'Hola',
      markdown: '# Hola',
      tags: [],
      version: 1,
    })
    // The local copy is gone: a second sign-in must not migrate it twice.
    expect(localStoreSummary()).toEqual({ notes: 0, folders: 0 })
  })

  it('keeps the local copy when the copy fails', async () => {
    const note = await createLocalNote(LOCAL_UID)
    await saveLocalNoteContent(note.id, { markdown: 'algo' })

    await expect(
      migrateLocalStore('user-1', {
        createFolder: vi.fn() as never,
        createNote: vi.fn(async () => {
          throw new Error('offline')
        }) as never,
        saveNoteContent: vi.fn() as never,
      })
    ).rejects.toThrow('offline')

    expect(localStoreSummary().notes).toBe(1)
  })

  it('clears the store on demand', async () => {
    await createLocalNote(LOCAL_UID)
    clearLocalStore()
    expect(localStoreSummary()).toEqual({ notes: 0, folders: 0 })
  })
})
