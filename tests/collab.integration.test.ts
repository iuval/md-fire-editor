import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import * as Y from 'yjs'
import { FirestoreYjsProvider } from '../src/lib/collab/provider'
import { FirestoreAwareness } from '../src/lib/collab/awareness'

const PROJECT_ID = 'demo-mdfire'
const ALICE = 'alice-uid'
const BOB = 'bob-uid'
const VIEWER = 'viewer-uid'
const NOTE_ID = 'shared-note'

let env: RulesTestEnvironment

function blockEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    jid: 1,
    hash: '0123456789ab',
    bytes: 3,
    data: 'AQID',
    clientId: 1,
    createdAt: undefined as unknown,
    ...overrides,
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 12_000, label = 'condition'): Promise<void> {
  const start = Date.now()
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      if (predicate()) return resolvePromise()
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${label}`))
      setTimeout(tick, 60)
    }
    tick()
  })
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  await env.withSecurityRulesDisabled(async (ctx) => {
    const now = new Date()
    await setDoc(doc(ctx.firestore(), 'notes', NOTE_ID), {
      ownerId: ALICE,
      folderId: null,
      aclSource: 'own',
      memberIds: [ALICE, BOB, VIEWER],
      roles: { [ALICE]: 'owner', [BOB]: 'editor', [VIEWER]: 'viewer' },
      access: 'restricted',
      title: 'Compartida',
      markdown: '',
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  })
})

afterAll(async () => {
  await env.cleanup()
})

async function readUpdates(clientUid: string) {
  const { getDocs, collection } = await import('firebase/firestore')
  const fs = env.authenticatedContext(clientUid).firestore()
  const snap = await getDocs(collection(fs, 'notes', NOTE_ID, 'updates'))
  return snap.size
}

describe('real-time collaboration over Firestore', () => {
  it('two clients converge on the same text while editing simultaneously', async () => {
    const aliceFs = env.authenticatedContext(ALICE).firestore()
    const bobFs = env.authenticatedContext(BOB).firestore()

    const aliceDoc = new Y.Doc()
    const bobDoc = new Y.Doc()
    const aliceProvider = new FirestoreYjsProvider(NOTE_ID, aliceDoc, aliceFs)
    const bobProvider = new FirestoreYjsProvider(NOTE_ID, bobDoc, bobFs)

    const statuses: string[] = []
    aliceProvider.onStatus((s) => statuses.push(`alice:${s.connected}`))
    bobProvider.onStatus((s) => statuses.push(`bob:${s.connected}`))

    aliceProvider.connect()
    bobProvider.connect()
    await waitFor(() => statuses.includes('alice:true') && statuses.includes('bob:true'), 12_000, 'providers connected')

    // Seed content from Alice and wait until Bob receives it.
    aliceDoc.getText('content').insert(0, 'Hola equipo')
    await waitFor(
      () => bobDoc.getText('content').toString() === 'Hola equipo',
      12_000,
      'bob to receive alice seed'
    )

    // Both type at the same time, neither has seen the other's edit yet.
    aliceDoc.getText('content').insert(aliceDoc.getText('content').length, ' — línea de Alicia')
    bobDoc.getText('content').insert(0, 'Línea de Bruno. ')

    await waitFor(
      () =>
        aliceDoc.getText('content').toString() === bobDoc.getText('content').toString() &&
        aliceDoc.getText('content').toString().includes('Alicia') &&
        aliceDoc.getText('content').toString().includes('Bruno'),
      15_000,
      'both clients to converge with both edits'
    )

    const merged = aliceDoc.getText('content').toString()
    expect(merged).toContain('Línea de Bruno. ')
    expect(merged).toContain(' — línea de Alicia')

    // The update log is what a fresh client would replay.
    expect(await readUpdates(ALICE)).toBeGreaterThan(0)

    aliceProvider.destroy()
    bobProvider.destroy()
    aliceDoc.destroy()
    bobDoc.destroy()
  })

  it('a late joiner reconstructs the full document from the log', async () => {
    const carolFs = env.authenticatedContext(ALICE).firestore()
    const lateDoc = new Y.Doc()
    const lateProvider = new FirestoreYjsProvider(NOTE_ID, lateDoc, carolFs)
    lateProvider.connect()

    await waitFor(() => lateDoc.getText('content').toString().includes('Bruno'), 12_000, 'late joiner hydration')

    lateProvider.destroy()
    lateDoc.destroy()
  })

  it('presence is visible to the other participant', async () => {
    const aliceFs = env.authenticatedContext(ALICE).firestore()
    const bobFs = env.authenticatedContext(BOB).firestore()
    const aliceY = new Y.Doc()
    const bobY = new Y.Doc()

    const aliceAwareness = new FirestoreAwareness(NOTE_ID, ALICE, { name: 'Alicia', color: '#c25e00' }, aliceY, aliceFs)
    const bobAwareness = new FirestoreAwareness(NOTE_ID, BOB, { name: 'Bruno', color: '#2563eb' }, bobY, bobFs)

    let bobSees: string[] = []
    const off = bobAwareness.onUserChange((users) => {
      bobSees = users.map((u) => u.name)
    })

    aliceAwareness.connect()
    bobAwareness.connect()
    aliceAwareness.setLocalStateField('user', { name: 'Alicia', color: '#c25e00' })
    bobAwareness.setLocalStateField('user', { name: 'Bruno', color: '#2563eb' })

    await waitFor(() => bobSees.includes('Alicia'), 12_000, 'bob to see alice presence')

    off()
    aliceAwareness.destroy()
    bobAwareness.destroy()
    aliceY.destroy()
    bobY.destroy()
  })

  it('a non-member cannot read the shared document updates', async () => {
    const strangerFs = env.authenticatedContext('stranger-uid').firestore()
    const { getDocs, collection } = await import('firebase/firestore')
    await expect(getDocs(collection(strangerFs, 'notes', NOTE_ID, 'updates'))).rejects.toThrow()
  })

  it('a non-member cannot append updates', async () => {
    const strangerFs = env.authenticatedContext('stranger-uid').firestore()
    const { addDoc, serverTimestamp } = await import('firebase/firestore')
    const { collection } = await import('firebase/firestore')
    await expect(
      addDoc(collection(strangerFs, 'notes', NOTE_ID, 'updates'), {
        ...blockEnvelope(),
        createdAt: serverTimestamp(),
      })
    ).rejects.toThrow()
  })

  it('a viewer hydrates the document but every write is rejected', async () => {
    const viewerFs = env.authenticatedContext(VIEWER).firestore()
    const viewerDoc = new Y.Doc()
    const viewerProvider = new FirestoreYjsProvider(NOTE_ID, viewerDoc, viewerFs)
    viewerProvider.connect()

    // Read path works: the viewer receives the shared text.
    await waitFor(
      () => viewerDoc.getText('content').toString().includes('Bruno'),
      12_000,
      'viewer to hydrate'
    )

    // Write path is denied by the rules.
    const { addDoc, serverTimestamp, collection } = await import('firebase/firestore')
    await expect(
      addDoc(collection(viewerFs, 'notes', NOTE_ID, 'updates'), {
        ...blockEnvelope(),
        createdAt: serverTimestamp(),
      })
    ).rejects.toThrow()

    viewerProvider.destroy()
    viewerDoc.destroy()
  })

  it('propagates while the writer keeps typing (trailing throttle, not debounce)', async () => {
    const aliceFs = env.authenticatedContext(ALICE).firestore()
    const bobFs = env.authenticatedContext(BOB).firestore()

    const aliceDoc = new Y.Doc()
    const bobDoc = new Y.Doc()
    const alice = new FirestoreYjsProvider(NOTE_ID, aliceDoc, aliceFs)
    const bob = new FirestoreYjsProvider(NOTE_ID, bobDoc, bobFs)
    alice.connect()
    bob.connect()
    await waitFor(() => bobDoc.getText('content').length > 0, 12_000, 'initial hydration').catch(
      () => undefined
    )

    const text = aliceDoc.getText('content')
    const start = Date.now()
    let sawWhileTyping = false

    // 3 s of continuous typing, never pausing long enough for a debounce.
    for (let i = 0; i < 30; i++) {
      text.insert(text.length, 'x')
      await new Promise((r) => setTimeout(r, 100))
      if (!sawWhileTyping && bobDoc.getText('content').length > 0) {
        sawWhileTyping = true
        expect(Date.now() - start).toBeLessThan(2000)
      }
    }

    expect(sawWhileTyping).toBe(true)
    await waitFor(
      () => aliceDoc.getText('content').toString() === bobDoc.getText('content').toString(),
      12_000,
      'convergence'
    )

    alice.destroy()
    bob.destroy()
    aliceDoc.destroy()
    bobDoc.destroy()
  })

  it('compaction writes a manifest and prunes the blocks it folded in', async () => {
    const aliceFs = env.authenticatedContext(ALICE).firestore()
    const { getDocs, collection, getDoc, doc: docRef } = await import('firebase/firestore')

    const aliceDoc = new Y.Doc()
    const alice = new FirestoreYjsProvider(NOTE_ID, aliceDoc, aliceFs)
    alice.connect()
    await new Promise((r) => setTimeout(r, 600))

    const text = aliceDoc.getText('content')
    for (let i = 0; i < 6; i++) {
      text.insert(text.length, `bloque ${i}. `)
      await new Promise((r) => setTimeout(r, 400))
    }
    await new Promise((r) => setTimeout(r, 900))

    const before = await getDocs(collection(aliceFs, 'notes', NOTE_ID, 'updates'))
    expect(before.size).toBeGreaterThan(1)

    await alice.compactNow()
    await new Promise((r) => setTimeout(r, 400))

    const manifest = await getDoc(docRef(aliceFs, 'notes', NOTE_ID, 'collab', 'manifest'))
    expect(manifest.exists()).toBe(true)
    expect(typeof manifest.data()!.snapshot).toBe('string')
    expect(manifest.data()!.jid).toBeGreaterThan(0)

    const after = await getDocs(collection(aliceFs, 'notes', NOTE_ID, 'updates'))
    expect(after.size).toBeLessThan(before.size)

    // A cold client still gets the whole document from the manifest.
    const coldDoc = new Y.Doc()
    const cold = new FirestoreYjsProvider(NOTE_ID, coldDoc, aliceFs)
    cold.connect()
    await waitFor(
      () => coldDoc.getText('content').toString() === text.toString(),
      12_000,
      'cold join from manifest'
    )

    alice.destroy()
    cold.destroy()
    aliceDoc.destroy()
    coldDoc.destroy()
  })

  it('rejects a block whose content does not match its hash', async () => {
    const aliceFs = env.authenticatedContext(ALICE).firestore()
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore')

    const doc = new Y.Doc()
    const provider = new FirestoreYjsProvider(NOTE_ID, doc, aliceFs)
    let error: string | null = null
    provider.onStatus((s) => {
      if (s.error) error = s.error
    })
    provider.connect()
    await new Promise((r) => setTimeout(r, 600))

    const forged = new Y.Doc()
    forged.getText('content').insert(0, 'INYECTADO')
    const payload = Y.encodeStateAsUpdate(forged)

    await addDoc(collection(aliceFs, 'notes', NOTE_ID, 'updates'), {
      v: 1,
      jid: 9000,
      hash: '000000000000',
      bytes: payload.byteLength,
      data: Buffer.from(payload).toString('base64'),
      clientId: 4242,
      createdAt: serverTimestamp(),
    })

    await new Promise((r) => setTimeout(r, 1200))
    expect(doc.getText('content').toString()).not.toContain('INYECTADO')
    expect(error).toMatch(/hash/i)
    expect(provider.stats.rejectedBlocks).toBeGreaterThan(0)

    provider.destroy()
    doc.destroy()
  })

  it('a member can persist the serialized markdown on the note document', async () => {
    const bobFs = env.authenticatedContext(BOB).firestore()
    await expect(
      updateDoc(doc(bobFs, 'notes', NOTE_ID), {
        markdown: '# Hola\n\nTexto colaborativo',
        title: 'Compartida',
        updatedAt: new Date(),
      })
    ).resolves.toBeUndefined()
  })
})
