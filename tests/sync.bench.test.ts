/**
 * Sync cost harness. Not part of the normal suite — run with:
 *
 *   npm run bench:sync
 *
 * It drives two real providers against the Firestore emulator and reports the
 * numbers the design is judged on: blocks written per typing session, bytes per
 * block, and what a cold join has to read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDocs, collection } from 'firebase/firestore'
import * as Y from 'yjs'
import type { LocalChannelFactory } from '../src/lib/collab/localChannel'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROJECT_ID = 'demo-firemd'
const NOTE_ID = 'bench-note'

// These tests must exercise the network path only: a real BroadcastChannel
// would let the two clients agree locally and pass without Firestore.
const NO_LOCAL_LANE: LocalChannelFactory = () => null
const OWNER = 'bench-owner'

let env: RulesTestEnvironment

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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
  const now = new Date()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notes', NOTE_ID), {
      ownerId: OWNER,
      folderId: null,
      aclSource: 'own',
      memberIds: [OWNER],
      roles: { [OWNER]: 'owner' },
      access: 'restricted',
      title: 'Bench',
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

describe('sync cost', () => {
  it('measures a typing session and a cold join', async () => {
    const { FirestoreYjsProvider } = await import('../src/lib/collab/provider')

    const aliceFs = env.authenticatedContext(OWNER).firestore()
    const bobFs = env.authenticatedContext('bench-bob').firestore()

    // Bob is a member too.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const noteRef = doc(ctx.firestore(), 'notes', NOTE_ID)
      const snap = await import('firebase/firestore').then((m) => m.getDoc(noteRef))
      await setDoc(noteRef, {
        ...snap.data(),
        memberIds: [OWNER, 'bench-bob'],
        roles: { [OWNER]: 'owner', 'bench-bob': 'editor' },
      })
    })

    const aliceDoc = new Y.Doc()
    const bobDoc = new Y.Doc()
    const alice = new FirestoreYjsProvider(NOTE_ID, aliceDoc, aliceFs, NO_LOCAL_LANE)
    const bob = new FirestoreYjsProvider(NOTE_ID, bobDoc, bobFs, NO_LOCAL_LANE)
    alice.connect()
    bob.connect()
    await sleep(800)

    // ~8 s of typing: 200 bursts of 3 characters every 40 ms.
    const text = aliceDoc.getText('content')
    const started = Date.now()
    let firstRemoteAt = 0
    for (let i = 0; i < 200; i++) {
      text.insert(text.length, `w${i % 10} `)
      await sleep(40)
      if (!firstRemoteAt && bobDoc.getText('content').length > 0) {
        firstRemoteAt = Date.now() - started
      }
    }
    const typingMs = Date.now() - started

    // Let the last flush land and Bob catch up.
    await sleep(2500)
    const converged = aliceDoc.getText('content').toString() === bobDoc.getText('content').toString()

    const updates = await getDocs(collection(aliceFs, 'notes', NOTE_ID, 'updates'))
    const manifestSnap = await import('firebase/firestore').then((m) =>
      m.getDoc(m.doc(aliceFs, 'notes', NOTE_ID, 'collab', 'manifest'))
    )
    const meta = { size: manifestSnap.exists() ? 1 : 0 }
    const blockBytes = updates.docs.reduce((sum, d) => sum + String(d.data().data ?? '').length, 0)

    // Cold join: a third client that has nothing.
    const coldDoc = new Y.Doc()
    const cold = new FirestoreYjsProvider(NOTE_ID, coldDoc, aliceFs, NO_LOCAL_LANE)
    const coldStart = Date.now()
    cold.connect()
    for (let i = 0; i < 100 && coldDoc.getText('content').length === 0; i++) await sleep(50)
    const coldMs = Date.now() - coldStart

    const report = {
      typingSeconds: Number((typingMs / 1000).toFixed(1)),
      firstRemoteEditMs: firstRemoteAt,
      blocksWritten: alice.stats.blocksWritten + bob.stats.blocksWritten,
      bytesWritten: alice.stats.bytesWritten + bob.stats.bytesWritten,
      avgBlockBytes: Number(
        ((alice.stats.bytesWritten + bob.stats.bytesWritten) /
          Math.max(1, alice.stats.blocksWritten + bob.stats.blocksWritten)).toFixed(0)
      ),
      rejectedBlocks: alice.stats.rejectedBlocks + bob.stats.rejectedBlocks,
      compactions: alice.stats.compactions + bob.stats.compactions,
      logDocsRemaining: updates.size,
      logBytesRemaining: blockBytes,
      collabDocs: meta.size,
      coldJoinMs: coldMs,
      coldJoinReads: 1 + meta.size + updates.size,
      converged,
    }

    const out = process.env.BENCH_OUT || '/tmp/sync-bench.json'
    // eslint-disable-next-line no-console
    const { writeFileSync } = await import('node:fs')
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`SYNC BENCH -> ${out}`)

    expect(converged).toBe(true)

    alice.destroy()
    bob.destroy()
    cold.destroy()
    aliceDoc.destroy()
    bobDoc.destroy()
    coldDoc.destroy()
  }, 120_000)
})
