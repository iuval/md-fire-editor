import { describe, expect, it } from 'vitest'
import {
  MAX_MARKDOWN_BYTES,
  MAX_TITLE_LENGTH,
  buildNoteDocument,
  bodyDocument,
  buildNoteUpdate,
  mergeDeferred,
  newNoteDraft,
  optimisticFolder,
  reserveFolderId,
  reserveNoteId,
  rootPatch,
  settleWrites,
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

describe('optimistic note (the tab paints before the write lands)', () => {
  const folder: Folder = {
    id: 'f1',
    ownerId: 'u1',
    name: 'Guiones',
    parentId: null,
    order: 0,
    tags: [],
    memberIds: ['u1', 'u2'],
    roles: { u1: 'owner', u2: 'editor' },
    access: 'restricted',
  }

  it('carries exactly the fields createNote writes', () => {
    const draft = newNoteDraft('u1', folder, 'n1', 'canvas')
    const written = buildNoteDocument(
      'u1',
      { title: draft.title, markdown: draft.markdown, tags: draft.tags, folder, kind: 'canvas' },
      serverTimestamp()
    )
    expect(written).toMatchObject({
      ownerId: draft.ownerId,
      folderId: draft.folderId,
      aclSource: draft.aclSource,
      memberIds: draft.memberIds,
      roles: draft.roles,
      access: draft.access,
      title: draft.title,
      tags: draft.tags,
      version: draft.version,
      order: draft.order,
      kind: 'canvas',
    })
    // A new note has no title: the pane shows "Untitled" as its placeholder, and
    // a note nobody names stays nameless instead of storing that word.
    expect(draft.title).toBe('')
    // An empty body, so the pane renders an empty document instead of waiting.
    expect(draft.markdown).toBe('')
  })

  it('leaves markdown notes without a kind field, like every note ever written', () => {
    const draft = newNoteDraft('u1', null, 'n2')
    const written = buildNoteDocument(
      'u1',
      { title: draft.title, markdown: '', tags: [], folder: null },
      serverTimestamp()
    )
    expect('kind' in written).toBe(false)
    expect(draft.title).toBe('')
    expect(draft.kind).toBe('note')
    expect(draft.aclSource).toBe('own')
    expect(draft.roles).toEqual({ u1: 'owner' })
  })
})

describe('edits typed before the note exists', () => {
  it('keeps the last value per field, so a rename and a body edit both survive', () => {
    const first = mergeDeferred(null, { title: 'Mapa' }, MAX_MARKDOWN_BYTES)
    const second = mergeDeferred(first, { markdown: '{"nodes": []}', tags: [] }, 600_000)
    expect(second).toEqual({
      patch: { title: 'Mapa', markdown: '{"nodes": []}', tags: [] },
      maxChars: 600_000,
    })
    // A later rename does not drop the queued body.
    expect(mergeDeferred(second, { title: 'Mapa POV' }, 600_000).patch.markdown).toBe(
      '{"nodes": []}'
    )
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
    expect(folder.name).toBe('Folder')
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

describe('emptying a folder to delete it', () => {
  it('gives each note back to its author, never to the person deleting', () => {
    // The note may have been written by an agent or a co-editor invited into the
    // folder. The rules accept the move only if the note stays the author's.
    expect(rootPatch({ ownerId: 'agent-uid' })).toEqual({
      folderId: null,
      aclSource: 'own',
      memberIds: ['agent-uid'],
      roles: { 'agent-uid': 'owner' },
      access: 'restricted',
    })
  })

  it('writes the whole folder in one batch when nothing is refused', async () => {
    const batches: string[][] = []
    const refused = await settleWrites(
      ['a', 'b'],
      async (ops) => {
        batches.push(ops)
      },
      async () => {
        throw new Error('the fallback should not run')
      }
    )

    expect(batches).toEqual([['a', 'b']])
    expect(refused).toEqual([])
  })

  it('retries one document at a time when the batch is refused', async () => {
    // Regression: a note somebody else wrote made the batch fail, so the folder
    // could never be deleted ("Missing or insufficient permissions").
    const written: string[] = []
    const refused = await settleWrites(
      ['mine', 'theirs'],
      async () => {
        throw new Error('Missing or insufficient permissions.')
      },
      async (op) => {
        if (op === 'theirs') throw new Error('Missing or insufficient permissions.')
        written.push(op)
      }
    )

    expect(written).toEqual(['mine'])
    expect(refused).toEqual(['theirs'])
  })

  it('does not touch Firestore for an empty folder', async () => {
    let called = false
    const refused = await settleWrites(
      [],
      async () => {
        called = true
      },
      async () => {
        called = true
      }
    )

    expect(called).toBe(false)
    expect(refused).toEqual([])
  })
})
