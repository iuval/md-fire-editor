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
const NOTE_ID = 'shared-note'

let env: RulesTestEnvironment

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
      memberIds: [ALICE, BOB],
      roles: { [ALICE]: 'owner', [BOB]: 'editor' },
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
        data: 'AQID',
        clientId: 1,
        createdAt: serverTimestamp(),
      })
    ).rejects.toThrow()
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
