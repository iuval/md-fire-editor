import { describe, expect, it } from 'vitest'
import {
  MAX_MARKDOWN_BYTES,
  MAX_TITLE_LENGTH,
  buildNoteDocument,
  bodyDocument,
  buildNoteUpdate,
  optimisticFolder,
  reserveFolderId,
  reserveNoteId,
  type Folder,
  type Note,
} from '../src/lib/notes'
import { DEFAULT_SORT } from '../src/lib/sorting'
import { serverTimestamp } from 'firebase/firestore'
import { pendingBodies } from '../src/lib/diagnostics'

describe('note patches', () => {
  it('never writes a field the caller did not send', () => {
    // Regression: saving markdown used to write `title: ''`, wiping the title one
    // second after a note was opened.
    const update = buildNoteUpdate({ tags: ['x'], version: 4, markdownBytes: 4 })

    expect(update).toEqual({ tags: ['x'], version: 4, markdownBytes: 4 })
    expect('title' in update).toBe(false)
  })

  it('never carries the body into the note document', () => {
    // The body is its own document: that is what keeps the workspace list small.
    expect('markdown' in buildNoteUpdate({ title: 'Hola', markdownBytes: 12 })).toBe(false)
    expect(bodyDocument('hola', 3)).toMatchObject({ markdown: 'hola', bytes: 4, version: 3 })
  })

  it('keeps markdown and tags untouched when only the title changes', () => {
    const update = buildNoteUpdate({ title: 'Nuevo' })
    expect(update).toEqual({ title: 'Nuevo' })
    expect('markdown' in update).toBe(false)
    expect('tags' in update).toBe(false)
  })

  it('truncates long titles and accepts an explicit empty title', () => {
    expect(buildNoteUpdate({ title: 'a'.repeat(400) }).title).toHaveLength(MAX_TITLE_LENGTH)
    expect(buildNoteUpdate({ title: '' })).toEqual({ title: '' })
  })

  it('reserves a unique id before the document exists', () => {
    // The tab opens with this id on the first frame; the Firestore write fills
    // in the document a moment later.
    const first = reserveNoteId()
    const second = reserveNoteId()
    expect(typeof first).toBe('string')
    expect(first).not.toBe(second)
  })

  it('handles a patch with only tags (property edits)', () => {
    expect(buildNoteUpdate({ tags: [] })).toEqual({ tags: [] })
  })
})

describe('note creation with content (vault import)', () => {
  const folder: Folder = {
    id: 'f1',
    ownerId: 'u1',
    name: 'Trabajo',
    parentId: null,
    order: 0,
    tags: [],
    memberIds: ['u1', 'u2'],
    roles: { u1: 'owner', u2: 'editor' },
    access: 'restricted',
  }

  it('writes title, body and tags in one document', () => {
    const now = serverTimestamp()
    const document = buildNoteDocument(
      'u1',
      { title: `  ${'a'.repeat(400)}  `, markdown: '# Hola', tags: ['uno'], folder: null },
      now
    )

    expect(document).toMatchObject({
      ownerId: 'u1',
      folderId: null,
      aclSource: 'own',
      memberIds: ['u1'],
      markdownBytes: '# Hola'.length,
      tags: ['uno'],
      version: 1,
      order: 0,
    })
    // The text is not in this document any more; only its size is.
    expect('markdown' in document).toBe(false)
    expect((document.title as string).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    // The create rule requires the two timestamps to be the same value.
    expect(document.createdAt).toBe(document.updatedAt)
  })

  it('inherits the folder ACL, which is what the rules check', () => {
    const document = buildNoteDocument(
      'u1',
      { title: 'En carpeta', markdown: '', tags: [], folder },
      serverTimestamp()
    )

    expect(document).toMatchObject({
      folderId: 'f1',
      aclSource: 'folder',
      memberIds: ['u1', 'u2'],
      roles: { u1: 'owner', u2: 'editor' },
      access: 'restricted',
    })
  })

  it('caps the body at MAX_MARKDOWN_BYTES in the body document', () => {
    const body = bodyDocument('x'.repeat(MAX_MARKDOWN_BYTES + 500))
    expect((body.markdown as string).length).toBe(MAX_MARKDOWN_BYTES)
    expect(body.bytes).toBe(MAX_MARKDOWN_BYTES)

    const document = buildNoteDocument(
      'u1',
      { title: 'Larga', markdown: 'x'.repeat(MAX_MARKDOWN_BYTES + 500), tags: [], folder: null },
      serverTimestamp()
    )
    expect(document.markdownBytes).toBe(MAX_MARKDOWN_BYTES)
  })
})

describe('optimistic folder', () => {
  it('is exactly what createFolder writes, so the snapshot confirms it unchanged', () => {
    const folder = optimisticFolder('u1', 'f9', '  Guiones  ', 'p1', { sort: 'manual', order: 30 })
    expect(folder).toMatchObject({
      id: 'f9',
      ownerId: 'u1',
      name: 'Guiones',
      parentId: 'p1',
      sort: 'manual',
      order: 30,
      tags: [],
      memberIds: ['u1'],
      roles: { u1: 'owner' },
      access: 'restricted',
    })
  })

  it('falls back to the default name and sort', () => {
    const folder = optimisticFolder('u1', 'f9', '   ', null)
    expect(folder.name).toBe('Carpeta')
    expect(folder.sort).toBe(DEFAULT_SORT)
    expect(folder.parentId).toBeNull()
  })

  it('reserves a distinct id per folder', () => {
    const first = reserveFolderId()
    const second = reserveFolderId()
    expect(typeof first).toBe('string')
    expect(first).not.toBe(second)
  })
})

describe('how much of the vault is still in the list', () => {
  const base = {
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own' as const,
    memberIds: ['u1'],
    roles: { u1: 'owner' as const },
    access: 'restricted' as const,
    title: 'Nota',
    tags: [],
    order: 0,
    version: 1,
  }

  it('counts only the notes whose body still travels in the list', () => {
    const notes: Note[] = [
      { ...base, id: 'migrated', markdown: '', markdownBytes: 12_000 },
      { ...base, id: 'empty', markdown: '' },
      { ...base, id: 'legacy', markdown: 'x'.repeat(500) },
      { ...base, id: 'legacy2', markdown: 'y'.repeat(300) },
    ]

    expect(pendingBodies(notes)).toEqual({ count: 2, characters: 800 })
    expect(pendingBodies([])).toEqual({ count: 0, characters: 0 })
  })
})
