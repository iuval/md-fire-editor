import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'

const PROJECT_ID = 'demo-mdfire'
const OWNER = 'owner-uid'
const EDITOR = 'editor-uid'
const STRANGER = 'stranger-uid'

let env: RulesTestEnvironment

const ts = () => new Date()

function noteDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER,
    memberIds: [OWNER],
    roles: { [OWNER]: 'owner' },
    access: 'restricted',
    title: 'Note',
    markdown: '# hello',
    version: 1,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  }
}

function db(uid?: string) {
  return uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()
}

async function seedNote(id: string, overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'notes', id), noteDoc(overrides))
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
})

afterEach(async () => {
  await env.clearFirestore()
})

afterAll(async () => {
  await env.cleanup()
})

describe('notes: create', () => {
  it('owner can create a well-formed note', async () => {
    await assertSucceeds(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc()))
  })

  it('rejects anonymous create', async () => {
    await assertFails(setDoc(doc(db(), 'notes', 'n1'), noteDoc()))
  })

  it('rejects create with a different ownerId', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'notes', 'n1'), noteDoc()))
  })

  it('rejects create without owner role', async () => {
    await assertFails(
      setDoc(
        doc(db(OWNER), 'notes', 'n1'),
        noteDoc({ roles: { [OWNER]: 'editor' } })
      )
    )
  })

  it('rejects create that already pre-authorizes other members', async () => {
    await assertFails(
      setDoc(
        doc(db(OWNER), 'notes', 'n1'),
        noteDoc({ memberIds: [OWNER, STRANGER], roles: { [OWNER]: 'owner', [STRANGER]: 'editor' } })
      )
    )
  })

  it('rejects oversized markdown (250 KB cap)', async () => {
    await assertFails(
      setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ markdown: 'x'.repeat(250_001) }))
    )
  })

  it('rejects oversized title', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ title: 'x'.repeat(301) })))
  })

  it('rejects unknown fields', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ isAdmin: true })))
  })

  it('rejects invalid access mode', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ access: 'public' })))
  })
})

describe('notes: read', () => {
  it('owner can read', async () => {
    await seedNote('n1')
    await assertSucceeds(getDoc(doc(db(OWNER), 'notes', 'n1')))
  })

  it('non-member cannot read a restricted note', async () => {
    await seedNote('n1')
    await assertFails(getDoc(doc(db(STRANGER), 'notes', 'n1')))
  })

  it('anonymous cannot read a link-edit note', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertFails(getDoc(doc(db(), 'notes', 'n1')))
  })

  it('signed-in user can read a link-edit note', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'notes', 'n1')))
  })

  it('member can list own notes with array-contains', async () => {
    await seedNote('n1', { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } })
    const q = query(collection(db(EDITOR), 'notes'), where('memberIds', 'array-contains', EDITOR))
    await assertSucceeds(getDocs(q))
  })

  it('non-member listing with array-contains yields no documents', async () => {
    await seedNote('n1')
    const q = query(collection(db(STRANGER), 'notes'), where('memberIds', 'array-contains', STRANGER))
    const snap = await assertSucceeds(getDocs(q))
    expect(snap.size).toBe(0)
  })

  it('non-member broad listing without constraint is denied', async () => {
    await seedNote('n1')
    await assertFails(getDocs(collection(db(STRANGER), 'notes')))
  })

  it('member listing without the ownership constraint is denied', async () => {
    await seedNote('n1', { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } })
    await assertFails(getDocs(collection(db(EDITOR), 'notes')))
  })
})

describe('notes: update', () => {
  const shared = { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } }

  it('editor can change markdown', async () => {
    await seedNote('n1', shared)
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: '# edited', updatedAt: ts() }))
  })

  it('link editor can change markdown', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertSucceeds(
      updateDoc(doc(db(STRANGER), 'notes', 'n1'), { markdown: 'hi', updatedAt: ts() })
    )
  })

  it('editor cannot escalate by adding a member', async () => {
    await seedNote('n1', shared)
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), {
        memberIds: [OWNER, EDITOR, STRANGER],
        roles: { [OWNER]: 'owner', [EDITOR]: 'editor', [STRANGER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('editor cannot flip a note to link-edit', async () => {
    await seedNote('n1', shared)
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { access: 'link-edit', updatedAt: ts() }))
  })

  it('editor cannot hijack ownership', async () => {
    await seedNote('n1', shared)
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { ownerId: EDITOR, updatedAt: ts() }))
  })

  it('editor cannot rewrite createdAt', async () => {
    await seedNote('n1', shared)
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), { createdAt: new Date(0), updatedAt: ts() })
    )
  })

  it('editor cannot write more than 250 KB', async () => {
    await seedNote('n1', shared)
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: 'x'.repeat(250_001), updatedAt: ts() })
    )
  })

  it('owner can add a member and grant editor role', async () => {
    await seedNote('n1')
    await assertSucceeds(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        memberIds: [OWNER, EDITOR],
        roles: { [OWNER]: 'owner', [EDITOR]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('owner cannot demote themselves (owner role invariant)', async () => {
    await seedNote('n1')
    await assertFails(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        roles: { [OWNER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('owner can share a note as link-edit', async () => {
    await seedNote('n1')
    await assertSucceeds(updateDoc(doc(db(OWNER), 'notes', 'n1'), { access: 'link-edit', updatedAt: ts() }))
  })

  it('stranger cannot write to a restricted note', async () => {
    await seedNote('n1')
    await assertFails(
      updateDoc(doc(db(STRANGER), 'notes', 'n1'), { markdown: 'pwned', updatedAt: ts() })
    )
  })

  it('removing access revokes further writes for a link editor', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'notes', 'n1'), { access: 'restricted', updatedAt: ts() })
    })
    await assertFails(
      updateDoc(doc(db(STRANGER), 'notes', 'n1'), { markdown: 'late write', updatedAt: ts() })
    )
  })
})

describe('notes: delete', () => {
  it('owner can delete', async () => {
    await seedNote('n1', { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } })
    await assertSucceeds(deleteDoc(doc(db(OWNER), 'notes', 'n1')))
  })

  it('editor cannot delete', async () => {
    await seedNote('n1', { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } })
    await assertFails(deleteDoc(doc(db(EDITOR), 'notes', 'n1')))
  })

  it('link editor cannot delete', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertFails(deleteDoc(doc(db(STRANGER), 'notes', 'n1')))
  })
})

describe('collab: updates sub-collection', () => {
  const shared = { memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner', [EDITOR]: 'editor' } }

  it('member can append an update', async () => {
    await seedNote('n1', shared)
    await assertSucceeds(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), {
        data: 'AQID',
        clientId: 123,
        createdAt: ts(),
      })
    )
  })

  it('non-member cannot append an update', async () => {
    await seedNote('n1')
    await assertFails(
      addDoc(collection(db(STRANGER), 'notes', 'n1', 'updates'), {
        data: 'AQID',
        clientId: 123,
        createdAt: ts(),
      })
    )
  })

  it('rejects updates larger than 400 KB', async () => {
    await seedNote('n1', shared)
    await assertFails(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), {
        data: 'A'.repeat(400_001),
        clientId: 1,
        createdAt: ts(),
      })
    )
  })

  it('rejects unexpected fields', async () => {
    await seedNote('n1', shared)
    await assertFails(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), {
        data: 'AQID',
        clientId: 1,
        createdAt: ts(),
        payload: 'x',
      })
    )
  })

  it('updates are immutable', async () => {
    await seedNote('n1', shared)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', 'n1', 'updates', 'u1'), {
        data: 'AQID',
        clientId: 1,
        createdAt: ts(),
      })
    })
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1', 'updates', 'u1'), { data: 'BAUG', createdAt: ts() })
    )
  })

  it('member can prune compacted updates', async () => {
    await seedNote('n1', shared)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', 'n1', 'updates', 'u1'), {
        data: 'AQID',
        clientId: 1,
        createdAt: ts(),
      })
    })
    await assertSucceeds(deleteDoc(doc(db(EDITOR), 'notes', 'n1', 'updates', 'u1')))
  })
})

describe('collab: state snapshot', () => {
  it('member can write state', async () => {
    await seedNote('n1')
    await assertSucceeds(
      setDoc(doc(db(OWNER), 'notes', 'n1', 'collab', 'state'), {
        state: 'AQID',
        clientId: 1,
        updatedAt: ts(),
      })
    )
  })

  it('non-member cannot write state', async () => {
    await seedNote('n1')
    await assertFails(
      setDoc(doc(db(STRANGER), 'notes', 'n1', 'collab', 'state'), {
        state: 'AQID',
        clientId: 1,
        updatedAt: ts(),
      })
    )
  })

  it('only the state document may be written', async () => {
    await seedNote('n1')
    await assertFails(
      setDoc(doc(db(OWNER), 'notes', 'n1', 'collab', 'other'), {
        state: 'AQID',
        clientId: 1,
        updatedAt: ts(),
      })
    )
  })
})

describe('presence', () => {
  it('user can write their own presence', async () => {
    await seedNote('n1')
    await assertSucceeds(
      setDoc(doc(db(OWNER), 'notes', 'n1', 'presence', OWNER), {
        userId: OWNER,
        clientId: 42,
        name: 'Ana',
        color: '#c25e00',
        cursor: 'AQID',
        selection: 'AQID',
        updatedAt: ts(),
      })
    )
  })

  it('rejects presence without clientId', async () => {
    await seedNote('n1')
    await assertFails(
      setDoc(doc(db(OWNER), 'notes', 'n1', 'presence', OWNER), {
        userId: OWNER,
        name: 'Ana',
        color: '#c25e00',
        cursor: 'AQID',
        selection: 'AQID',
        updatedAt: ts(),
      })
    )
  })

  it('user cannot write presence for somebody else', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertFails(
      setDoc(doc(db(STRANGER), 'notes', 'n1', 'presence', OWNER), {
        userId: OWNER,
        clientId: 42,
        name: 'Fake',
        color: '#000000',
        cursor: 'AQID',
        selection: 'AQID',
        updatedAt: ts(),
      })
    )
  })
})

describe('legacy v1 schema', () => {
  it('owner can still read old notes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'notes', 'old1'), {
        title: 'old',
        content: 'legacy',
      })
    })
    await assertSucceeds(getDoc(doc(db(OWNER), 'users', OWNER, 'notes', 'old1')))
  })

  it('legacy notes are write-frozen', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'notes', 'old1'), {
        title: 'old',
        content: 'legacy',
      })
    })
    await assertFails(
      updateDoc(doc(db(OWNER), 'users', OWNER, 'notes', 'old1'), { content: 'mutated' })
    )
  })

  it('other users cannot read legacy notes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'notes', 'old1'), { title: 'old' })
    })
    await assertFails(getDoc(doc(db(STRANGER), 'users', OWNER, 'notes', 'old1')))
  })
})

describe('catch-all', () => {
  it('denies unknown collections', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'secrets', 'x'), { a: 1 }))
  })
})
