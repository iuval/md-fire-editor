import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'

const PROJECT_ID = 'demo-firemd'
const OWNER = 'owner-uid'
const AUTH_EMULATOR = 'http://127.0.0.1:9099'

let env: RulesTestEnvironment
let core: typeof import('../agent/core.mjs')
let auth: typeof import('../agent/auth.mjs')
let editorToken: string
let editorUid: string
let viewerToken: string

async function anonymousUser(): Promise<{ idToken: string; uid: string }> {
  const response = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' }
  )
  const data = await response.json()
  if (!data.idToken) throw new Error(`auth emulator: ${JSON.stringify(data)}`)
  return { idToken: data.idToken, uid: data.localId }
}

function asAgent(token: string) {
  process.env.FIREMD_ID_TOKEN = token
}

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  process.env.FIREMD_PROJECT = PROJECT_ID
  process.env.FIREMD_API_KEY = 'fake-key'
  // Keep `firemd login` out of the developer's real home directory.
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'firemd-test-'))

  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  core = await import('../agent/core.mjs')
  auth = await import('../agent/auth.mjs')

  const editor = await anonymousUser()
  editorToken = editor.idToken
  editorUid = editor.uid
  const viewer = await anonymousUser()
  viewerToken = viewer.idToken
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
      memberIds: [OWNER, editorUid],
      roles: { [OWNER]: 'owner', [editorUid]: 'editor' },
      access: 'restricted',
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'folders', 'folder-private'), {
      ownerId: OWNER,
      name: 'Privada',
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
      memberIds: [OWNER, editorUid],
      roles: { [OWNER]: 'owner', [editorUid]: 'editor' },
      access: 'restricted',
      title: 'Ideas de producto',
      version: 3,
      createdAt: now,
      updatedAt: now,
    })
    // The body lives in its own document since the split; the app never writes
    // `notes.markdown` any more.
    await setDoc(doc(db, 'notes', 'noteideas01', 'body', 'main'), {
      markdown: '# Ideas\n\n- uno\n- dos\n',
      version: 3,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'notesecret1'), {
      ownerId: OWNER,
      folderId: 'folder-private',
      aclSource: 'folder',
      memberIds: [OWNER],
      roles: { [OWNER]: 'owner' },
      access: 'restricted',
      title: 'Secreto',
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'notesecret1', 'body', 'main'), {
      markdown: 'no deberías ver esto\n',
      version: 1,
      updatedAt: now,
    })
  })
})

describe('agent identity', () => {
  it('login creates an anonymous Firebase account and stores credentials', async () => {
    const credentials = await auth.login()
    expect(credentials.uid).toHaveLength(28)
    expect(credentials.refreshToken).toBeTruthy()

    const me = await auth.whoami()
    expect(me?.uid).toBe(credentials.uid)
    expect(auth.pairingCode(credentials.uid)).toBe(credentials.uid.slice(0, 12))

    // A refresh token can mint new ID tokens, so the CLI stays logged in.
    const token = await auth.idToken({ force: true })
    expect(token.split('.')).toHaveLength(3)
    expect(auth.uidFromToken(token)).toBe(credentials.uid)
  })

  it('logout revokes the stored refresh token', async () => {
    await auth.login()
    await auth.logout()
    const creds = await auth.readCredentials()
    expect(creds?.refreshToken).toBeNull()
    await expect(auth.idToken({ force: true })).rejects.toThrow(/refresh_token|INVALID|login/i)
  })
})

describe('agent reads through the rules', () => {
  it('lists only the notes it is a member of', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    const output = await core.listNotes(db, { limit: 10 })

    expect(output).toContain('Ideas de producto')
    expect(output).not.toContain('Secreto')
    expect(output.split('\n')).toHaveLength(1)
  })

  it('filters by folder name and root', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    expect(await core.listNotes(db, { folder: 'Trabajo' })).toContain('Ideas de producto')
    expect(await core.listNotes(db, { folder: 'root' })).toBe('')
  })

  it('lists folders it has access to', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    const folders = await core.listFolders(db)
    expect(folders).toContain('Trabajo')
    expect(folders).not.toContain('Privada')
  })

  it('reads a shared note as raw markdown', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    const note = await core.readNote(db, 'noteideas')
    expect(note.body).toBe('# Ideas\n\n- uno\n- dos\n')
    expect(note.etag).toMatch(/^3-[0-9a-f]{12}$/)
  })

  it('cannot read a note it was not invited to', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    await expect(core.readNote(db, 'notesecret1')).rejects.toThrow()
  })

  it('search sees only shared notes', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    expect(await core.searchNotes(db, 'uno')).toContain('noteidea')
    expect(await core.searchNotes(db, 'no deberías')).toBe('')
  })

  // Body documents are fetched with a field mask, so their text is not in hand
  // when the listing arrives. A note written before the split must still be found.
  it('search finds a note whose body never moved to its own document', async () => {
    // Created here instead of in the fixture: a second visible note would make
    // every other assertion about exact lists ambiguous.
    const now = new Date()
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { setDoc, doc } = await import('firebase/firestore')
      await setDoc(doc(ctx.firestore(), 'notes', 'notelegacy1'), {
        ownerId: OWNER,
        folderId: 'folder-work',
        aclSource: 'folder',
        memberIds: [OWNER, editorUid],
        roles: { [OWNER]: 'owner', [editorUid]: 'editor' },
        access: 'restricted',
        title: 'Vieja',
        markdown: '# Vieja\n\n- legado con palabras\n',
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
    })

    asAgent(editorToken)
    const db = await core.openStore()
    expect(await core.searchNotes(db, 'legado')).toContain('notelega')
  })
})

describe('agent writes through the rules', () => {
  it('editor can patch and the etag guard still applies', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    const before = await core.readNote(db, 'noteideas')

    const result = await core.patchNote(db, 'noteideas', [{ find: '- dos\n', replace: '- dos\n- tres\n' }], {
      etag: before.etag,
    })
    expect(result.delta).toBe(7)

    await expect(
      core.patchNote(db, 'noteideas', [{ find: 'uno', replace: '1' }], { etag: before.etag })
    ).rejects.toThrow(/etag/i)
  })

  it('keeps tags in sync when it edits, and lists them', async () => {
    asAgent(editorToken)
    const db = await core.openStore()

    const before = await core.readNote(db, 'noteideas')
    await core.patchNote(
      db,
      'noteideas',
      [{ find: '- dos\n', replace: '- dos #revisar\n' }],
      { etag: before.etag }
    )

    const note = await db.get('notes', 'noteideas01')
    expect(note.data.tags).toContain('revisar')

    const inventory = await core.listTags(db)
    expect(inventory).toContain('revisar')

    const byTag = await core.searchNotes(db, '', { tag: 'revisar' })
    expect(byTag).toContain('noteidea')
  })

  it('appends text, updates tags and can be found again', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    await core.appendNote(db, 'noteideas', '- tres #idea\n')
    expect(await core.searchNotes(db, 'tres')).toContain('noteidea')

    const note = await db.get('notes', 'noteideas01')
    expect(note.data.tags).toContain('idea')
    expect(await core.searchNotes(db, '', { tag: 'idea' })).toContain('noteidea')
  })

  it('creates a note inside a folder it can write, owned by the agent', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    const created = await core.createNote(db, { title: 'Desde el agente', folder: 'Trabajo', body: 'hola' })

    const note = await core.readNote(db, created.id)
    expect(note.body).toBe('hola')
    expect(await core.listNotes(db, { folder: 'Trabajo' })).toContain('Desde el agente')

    // The agent owns what it created, so it can delete it; the folder ACL is
    // what limits visibility.
    await core.deleteNote(db, created.id)
    await expect(core.readNote(db, created.id)).rejects.toThrow()
  })

  it('cannot create notes in a folder it cannot see', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    await expect(core.createNote(db, { title: 'x', folder: 'folder-private' })).rejects.toThrow()
  })

  it('cannot delete a note owned by somebody else', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    await expect(core.deleteNote(db, 'noteideas')).rejects.toThrow()
  })

  it('a viewer can read but not write', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const { updateDoc, doc } = await import('firebase/firestore')
      const viewerUid = auth.uidFromToken(viewerToken) as string
      await updateDoc(doc(db, 'folders', 'folder-work'), {
        memberIds: [OWNER, editorUid, viewerUid],
        roles: { [OWNER]: 'owner', [editorUid]: 'editor', [viewerUid]: 'viewer' },
      })
      await updateDoc(doc(db, 'notes', 'noteideas01'), {
        memberIds: [OWNER, editorUid, viewerUid],
        roles: { [OWNER]: 'owner', [editorUid]: 'editor', [viewerUid]: 'viewer' },
      })
    })

    asAgent(viewerToken)
    const db = await core.openStore()
    expect((await core.readNote(db, 'noteideas')).body).toContain('Ideas')
    await expect(
      core.patchNote(db, 'noteideas', [{ find: 'uno', replace: '1' }])
    ).rejects.toThrow()
  })

  it('revoking the agent from the folder cuts access immediately', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    expect(await core.listNotes(db)).toContain('Ideas de producto')

    // The owner revokes the agent. The note keeps its old member copy on
    // purpose: authority always comes from the folder, so the write window is
    // already closed even before any copy is refreshed.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore()
      const { updateDoc, doc } = await import('firebase/firestore')
      await updateDoc(doc(db2, 'folders', 'folder-work'), {
        memberIds: [OWNER],
        roles: { [OWNER]: 'owner' },
      })
    })

    await expect(core.readNote(db, 'noteideas')).rejects.toThrow()
    await expect(core.patchNote(db, 'noteideas', [{ find: 'uno', replace: '1' }])).rejects.toThrow()

    // Listing reads the member copy, which the web app refreshes when the owner
    // changes sharing (propagateFolderAcl). Simulate that refresh.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db2 = ctx.firestore()
      const { updateDoc, doc } = await import('firebase/firestore')
      await updateDoc(doc(db2, 'notes', 'noteideas01'), {
        memberIds: [OWNER],
        roles: { [OWNER]: 'owner' },
      })
    })
    expect(await core.listNotes(db)).toBe('')
  })
})

describe('agent usage metering', () => {
  const day = () => new Date().toISOString().slice(0, 10)

  it('counts reads and writes into the daily bucket', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    db.resetUsage()

    await core.listNotes(db)
    await core.readNote(db, 'noteideas')
    await core.patchNote(db, 'noteideas', [{ find: 'uno', replace: '1' }])

    const flushed = await db.flushUsage()
    expect(flushed.reads).toBeGreaterThan(0)
    expect(flushed.writes).toBeGreaterThan(0)

    const bucket = await db.get('usage', `${editorUid}/days/${day()}`)
    expect(bucket.data.day).toBe(day())
    expect(bucket.data.reads).toBeGreaterThanOrEqual(flushed.reads)
    expect(bucket.data.writes).toBeGreaterThanOrEqual(flushed.writes)
  })

  it('does not count the metering write itself', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    db.resetUsage()

    await core.listNotes(db)
    await db.flushUsage()

    // The flush wrote once to Firestore; that write must not be re-counted.
    expect(db.usage.writes).toBe(0)
    expect(db.usage.reads).toBe(0)
  })

  it('flushes nothing when there were no operations', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    db.resetUsage()
    expect(await db.flushUsage()).toBeNull()
  })

  it('counts agent operations and reads the daily total', async () => {
    asAgent(editorToken)
    const db = await core.openStore()
    db.resetUsage()
    db.meterAgentOp()
    db.meterAgentOp()
    const flushed = await db.flushUsage()
    expect(flushed.agentOps).toBe(2)
    const bucket = await db.get('usage', `${editorUid}/days/${day()}`)
    expect(bucket.data.agentOps).toBe(2)
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
