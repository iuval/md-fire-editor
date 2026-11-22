import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

const PROJECT_ID = 'demo-firemd'
const OWNER = 'owner-uid'
let env: RulesTestEnvironment
let core: typeof import('../agent/core.mjs')
let vault: typeof import('../agent/vault.mjs')
let agentUid: string
let dir: string

async function anonymousUser(): Promise<{ idToken: string; uid: string }> {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' }
  )
  const data = await response.json()
  return { idToken: data.idToken, uid: data.localId }
}

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  process.env.FIREMD_PROJECT = PROJECT_ID
  process.env.FIREMD_API_KEY = 'fake-key'
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'firemd-vault-cfg-'))

  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  core = await import('../agent/core.mjs')
  vault = await import('../agent/vault.mjs')

  const agent = await anonymousUser()
  agentUid = agent.uid
  process.env.FIREMD_ID_TOKEN = agent.idToken
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  dir = mkdtempSync(join(tmpdir(), 'vault-sync-'))
  const now = new Date()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const { setDoc, doc } = await import('firebase/firestore')
    await setDoc(doc(db, 'folders', 'folder-work'), {
      ownerId: OWNER,
      name: 'Trabajo',
      tags: ['equipo'],
      memberIds: [OWNER, agentUid],
      roles: { [OWNER]: 'owner', [agentUid]: 'editor' },
      access: 'restricted',
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'noteideas01'), {
      ownerId: OWNER,
      folderId: 'folder-work',
      aclSource: 'folder',
      memberIds: [OWNER, agentUid],
      roles: { [OWNER]: 'owner', [agentUid]: 'editor' },
      access: 'restricted',
      title: 'Ideas',
      tags: ['producto'],
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    await setDoc(doc(db, 'notes', 'noteideas01', 'body', 'main'), {
      markdown: '# Ideas\n\n- uno #producto\n',
      version: 1,
      updatedAt: now,
    })
  })
})

describe('vault pull', () => {
  it('writes one .md per note inside the folder mirror and records a manifest', async () => {
    const db = await core.openStore()
    const result = await vault.pull(db, { dir })

    expect(result.written).toBe(1)
    expect(existsSync(join(dir, 'Trabajo', 'Ideas.md'))).toBe(true)
    expect(readFileSync(join(dir, 'Trabajo', 'Ideas.md'), 'utf8')).toContain('# Ideas')

    const manifest = JSON.parse(readFileSync(join(dir, '.firemd', 'manifest.json'), 'utf8'))
    const entry = manifest.files['Trabajo/Ideas.md']
    expect(entry.id).toBe('noteideas01')
    expect(entry.etag).toMatch(/^1-[0-9a-f]{12}$/)
  })
})

describe('vault push', () => {
  it('uploads a local edit and keeps tags in sync', async () => {
    const db = await core.openStore()
    await vault.pull(db, { dir })

    const file = join(dir, 'Trabajo', 'Ideas.md')
    writeFileSync(file, '# Ideas\n\n- uno #producto\n- dos #nuevo\n')

    const result = await vault.push(db, { dir })
    expect(result.updated).toBe(1)
    expect(result.conflicts).toHaveLength(0)

    const body = await db.get('notes/noteideas01/body', 'main')
    expect(body.data.markdown).toContain('#nuevo')
    const note = await db.get('notes', 'noteideas01')
    expect(note.data.tags).toContain('nuevo')
  })

  it('never overwrites a newer remote edit: it writes a conflict file instead', async () => {
    const db = await core.openStore()
    await vault.pull(db, { dir })

    // Somebody (the app, another person) edits the note after the pull.
    const remote = await core.readNote(db, 'noteideas')
    await core.replaceNote(db, 'noteideas', '# Ideas\n\nrema editado\n', { etag: remote.etag })

    const file = join(dir, 'Trabajo', 'Ideas.md')
    writeFileSync(file, '# Ideas\n\nmi edición local\n')

    const result = await vault.push(db, { dir })
    expect(result.updated).toBe(0)
    expect(result.conflicts).toHaveLength(1)

    const conflictFile = join(dir, result.conflicts[0].conflict)
    expect(readFileSync(conflictFile, 'utf8')).toContain('mi edición local')

    const body = await db.get('notes/noteideas01/body', 'main')
    expect(body.data.markdown).toContain('rema editado')
  })

  it('creates a note for a new file inside a shared folder', async () => {
    const db = await core.openStore()
    await vault.pull(db, { dir })
    writeFileSync(join(dir, 'Trabajo', 'Nueva.md'), '# Nueva\n\ncontenido #x\n')

    const result = await vault.push(db, { dir })
    expect(result.created).toContain('Trabajo/Nueva.md')
    expect(await core.searchNotes(db, 'contenido')).toMatch(/Nueva|contenido/)
  })

  it('refuses a new file at the vault root with a clear message', async () => {
    const db = await core.openStore()
    await vault.pull(db, { dir })
    writeFileSync(join(dir, 'Suelta.md'), '# Suelta\n')

    const result = await vault.push(db, { dir })
    expect(result.errors.join(' ')).toMatch(/creá la nota desde la app/)
    expect(readdirSync(dir)).toContain('Suelta.md')
  })
})
