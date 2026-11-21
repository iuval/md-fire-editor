import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'

const OWNER = 'owner-uid'

let env: RulesTestEnvironment
let core: typeof import('../agent/core.mjs')

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  process.env.MDFIRE_PROJECT = 'demo-mdfire'

  env = await initializeTestEnvironment({
    projectId: 'demo-mdfire',
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  core = await import('../agent/core.mjs')
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  const now = new Date()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const { setDoc, doc } = await import('firebase/firestore')
    await setDoc(doc(db, 'folders', 'folder-work'), {
      ownerId: OWNER,
      name: 'Trabajo',
      memberIds: [OWNER],
      roles: { [OWNER]: 'owner' },
      access: 'restricted',
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'noteideas01'), {
      ownerId: OWNER,
      folderId: 'folder-work',
      aclSource: 'folder',
      memberIds: [OWNER],
      roles: { [OWNER]: 'owner' },
      access: 'restricted',
      title: 'Ideas de producto',
      markdown: '# Ideas\n\n- uno\n- dos\n',
      version: 3,
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'noteroot001'), {
      ownerId: OWNER,
      folderId: null,
      aclSource: 'own',
      memberIds: [OWNER],
      roles: { [OWNER]: 'owner' },
      access: 'restricted',
      title: 'Recetas',
      markdown: 'masa madre\nharina 100 g\n',
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  })
})

describe('CLI argument parsing', () => {
  it('keeps --etag values (regression: it used to be swallowed as a boolean)', async () => {
    const { parseArgs } = await import('../agent/args.mjs')
    const args = parseArgs(['noteidea', '--etag', '3-06e65c1ac760', '--find', '- dos', '--replace', '- tres'])
    expect(args.etag).toBe('3-06e65c1ac760')
    expect(args.find).toEqual(['- dos'])
    expect(args.replace).toEqual(['- tres'])
    expect(args._).toEqual(['noteidea'])
  })

  it('treats a bare --all as a boolean and accumulates edits', async () => {
    const { parseArgs } = await import('../agent/args.mjs')
    const args = parseArgs(['n1', '--all', '--find', 'a', '--replace', 'b', '--find', 'c', '--replace', 'd'])
    expect(args.all).toBe(true)
    expect(args.find).toEqual(['a', 'c'])
    expect(args.replace).toEqual(['b', 'd'])
  })
})

describe('agent CLI core', () => {
  it('lists notes as compact TSV with short ids and folder names', async () => {
    const db = core.openStore()
    const output = await core.listNotes(db, { limit: 10 })
    const lines = output.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines.join('\n')).toContain('Ideas de producto')
    expect(lines.join('\n')).toContain('Trabajo')
    // No markdown in the listing: only id, title, date, folder.
    expect(lines.join('\n')).not.toContain('masa madre')
    // Short ids are 8 chars, not the 20-char document ids.
    expect(lines[0].split('\t')[0]).toHaveLength(8)
  })

  it('filters by folder and by root', async () => {
    const db = core.openStore()
    const inFolder = await core.listNotes(db, { folder: 'Trabajo' })
    expect(inFolder).toContain('Ideas de producto')
    expect(inFolder).not.toContain('Recetas')

    const root = await core.listNotes(db, { folder: 'root' })
    expect(root).toContain('Recetas')
    expect(root).not.toContain('Ideas de producto')
  })

  it('reads raw markdown and never wraps it in JSON', async () => {
    const db = core.openStore()
    const note = await core.readNote(db, 'noteideas')
    expect(note.body).toBe('# Ideas\n\n- uno\n- dos\n')
    expect(note.etag).toMatch(/^3-[0-9a-f]{12}$/)
  })

  it('truncates large notes on request', async () => {
    const db = core.openStore()
    const note = await core.readNote(db, 'noteideas', { maxBytes: 8 })
    expect(note.truncated).toBe(true)
    expect(note.body).toContain('truncado')
  })

  it('patches by exact substring and returns only the delta', async () => {
    const db = core.openStore()
    const before = await core.readNote(db, 'noteideas')
    const result = await core.patchNote(
      db,
      'noteideas',
      [{ find: '- dos\n', replace: '- dos\n- tres\n' }],
      { etag: before.etag }
    )

    expect(result.delta).toBe(7)
    expect(result.edits).toBe(1)
    expect(result.etag).not.toBe(before.etag)

    const after = await core.readNote(db, 'noteideas')
    expect(after.body).toContain('- tres')
  })

  it('rejects a stale etag instead of overwriting', async () => {
    const db = core.openStore()
    await expect(
      core.patchNote(db, 'noteideas', [{ find: 'uno', replace: '1' }], { etag: '0-deadbeefcafe' })
    ).rejects.toThrow(/etag/)
  })

  it('rejects an ambiguous find so edits never hit the wrong place', async () => {
    const db = core.openStore()
    const before = await core.readNote(db, 'noteideas')
    await expect(
      core.patchNote(db, 'noteideas', [{ find: 'o', replace: 'X' }], { etag: before.etag })
    ).rejects.toThrow(/más de una vez/)
  })

  it('rejects a find that does not exist', async () => {
    const db = core.openStore()
    await expect(
      core.patchNote(db, 'noteideas', [{ find: 'no existe esto', replace: 'x' }])
    ).rejects.toThrow(/no encontré/)
  })

  it('appends text with a single newline', async () => {
    const db = core.openStore()
    const result = await core.appendNote(db, 'noteroot', '- sal\n')
    expect(result.delta).toBe(6)
    const after = await core.readNote(db, 'noteroot')
    expect(after.body).toBe('masa madre\nharina 100 g\n- sal\n')
  })

  it('searches bodies and returns id:line: text', async () => {
    const db = core.openStore()
    const hits = await core.searchNotes(db, 'harina')
    expect(hits).toMatch(/^noteroot:2: harina 100 g$/)
  })

  it('resolves unique id prefixes and reports ambiguity', async () => {
    const db = core.openStore()
    const note = await core.readNote(db, 'noteideas01')
    expect(note.id).toBe('noteideas01')
    await expect(core.readNote(db, 'note')).rejects.toThrow(/ambiguo/)
  })

  it('creates a note inside a folder inheriting its ACL', async () => {
    const db = core.openStore()
    const created = await core.createNote(db, { title: 'Nueva', folder: 'Trabajo', ownerId: OWNER })
    expect(created.short).toHaveLength(8)

    const snap = await db.collection('notes').doc(created.id).get()
    const data = snap.data()
    expect(data.aclSource).toBe('folder')
    expect(data.folderId).toBe('folder-work')
    expect(data.memberIds).toEqual([OWNER])
  })

  it('deletes a note', async () => {
    const db = core.openStore()
    await core.deleteNote(db, 'noteroot')
    await expect(core.readNote(db, 'noteroot')).rejects.toThrow()
  })
})
