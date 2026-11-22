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
  createLocalNote,
  deleteLocalNote,
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
      expect(note.title).toBe('Sin título')
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
