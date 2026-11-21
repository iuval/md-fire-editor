import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const PROJECT_ID = 'demo-mdfire'
const OWNER = 'owner-uid'
const EDITOR = 'editor-uid'
const VIEWER = 'viewer-uid'
const STRANGER = 'stranger-uid'

let env: RulesTestEnvironment

const ts = () => new Date()

function noteDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER,
    folderId: null,
    aclSource: 'own',
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

function folderDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER,
    name: 'Carpeta',
    memberIds: [OWNER],
    roles: { [OWNER]: 'owner' },
    access: 'restricted',
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

async function grantPaid(uid: string, plan: 'paid' | 'free' = 'paid') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'entitlements', uid), {
      plan,
      source: 'test',
      expiresAt: null,
      updatedAt: ts(),
    })
  })
}

async function seedFolder(id: string, overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'folders', id), folderDoc(overrides))
  })
}

const everyRole = {
  memberIds: [OWNER, EDITOR, VIEWER],
  roles: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'viewer' },
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

beforeEach(async () => {
  // Sharing is a paid feature; tests exercise it by default.
  await grantPaid(OWNER)
  await grantPaid(EDITOR)
})

describe('notes: create', () => {
  it('owner creates a root note', async () => {
    await assertSucceeds(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc()))
  })

  it('rejects anonymous create', async () => {
    await assertFails(setDoc(doc(db(), 'notes', 'n1'), noteDoc()))
  })

  it('rejects create with a foreign ownerId', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'notes', 'n1'), noteDoc()))
  })

  it('rejects a root note that already shares access', async () => {
    await assertFails(
      setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc(everyRole))
    )
  })

  it('rejects an aclSource of folder without a folder', async () => {
    await assertFails(
      setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ aclSource: 'folder' }))
    )
  })

  it('rejects oversized markdown', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ markdown: 'x'.repeat(250_001) })))
  })

  it('rejects unknown fields', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ isAdmin: true })))
  })

  it('rejects invalid access modes', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'notes', 'n1'), noteDoc({ access: 'public' })))
  })

  it('rejects roles that do not match memberIds', async () => {
    await assertFails(
      setDoc(
        doc(db(OWNER), 'notes', 'n1'),
        noteDoc({ memberIds: [OWNER, EDITOR], roles: { [OWNER]: 'owner' } })
      )
    )
  })
})

describe('notes in folders: create inherits the folder ACL', () => {
  it('a folder editor can create a note that mirrors the folder', async () => {
    await seedFolder('f1', everyRole)
    await assertSucceeds(
      setDoc(
        doc(db(EDITOR), 'notes', 'n1'),
        noteDoc({
          ownerId: EDITOR,
          folderId: 'f1',
          aclSource: 'folder',
          ...everyRole,
        })
      )
    )
  })

  it('rejects a note whose ACL differs from its folder', async () => {
    await seedFolder('f1', everyRole)
    await assertFails(
      setDoc(
        doc(db(EDITOR), 'notes', 'n1'),
        noteDoc({
          ownerId: EDITOR,
          folderId: 'f1',
          aclSource: 'folder',
          memberIds: [EDITOR],
          roles: { [EDITOR]: 'owner' },
        })
      )
    )
  })

  it('a viewer cannot create notes inside the folder', async () => {
    await seedFolder('f1', everyRole)
    await assertFails(
      setDoc(
        doc(db(VIEWER), 'notes', 'n1'),
        noteDoc({ ownerId: VIEWER, folderId: 'f1', aclSource: 'folder', ...everyRole })
      )
    )
  })

  it('a stranger cannot create notes inside the folder', async () => {
    await seedFolder('f1', everyRole)
    await assertFails(
      setDoc(
        doc(db(STRANGER), 'notes', 'n1'),
        noteDoc({ ownerId: STRANGER, folderId: 'f1', aclSource: 'folder', ...everyRole })
      )
    )
  })
})

describe('notes: read', () => {
  it('viewer can read', async () => {
    await seedNote('n1', everyRole)
    await assertSucceeds(getDoc(doc(db(VIEWER), 'notes', 'n1')))
  })

  it('non-member cannot read a restricted note', async () => {
    await seedNote('n1')
    await assertFails(getDoc(doc(db(STRANGER), 'notes', 'n1')))
  })

  it('link-view grants read to any signed-in user', async () => {
    await seedNote('n1', { access: 'link-view' })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'notes', 'n1')))
  })

  it('anonymous cannot read a link-view note', async () => {
    await seedNote('n1', { access: 'link-view' })
    await assertFails(getDoc(doc(db(), 'notes', 'n1')))
  })

  it('member can list own notes with array-contains', async () => {
    await seedNote('n1', everyRole)
    const q = query(collection(db(VIEWER), 'notes'), where('memberIds', 'array-contains', VIEWER))
    await assertSucceeds(getDocs(q))
  })

  it('non-member listing yields no documents', async () => {
    await seedNote('n1')
    const q = query(collection(db(STRANGER), 'notes'), where('memberIds', 'array-contains', STRANGER))
    const snap = await assertSucceeds(getDocs(q))
    expect(snap.size).toBe(0)
  })

  it('broad listing without the ownership constraint is denied', async () => {
    await seedNote('n1')
    await assertFails(getDocs(collection(db(STRANGER), 'notes')))
  })

  it('notes inherited from a link-shared folder are readable by link', async () => {
    await seedFolder('f1', { access: 'link-view' })
    await seedNote('n1', { folderId: 'f1', aclSource: 'folder', ownerId: OWNER })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'notes', 'n1')))
  })

  it('reading a missing note is denied without an evaluation error', async () => {
    await assertFails(getDoc(doc(db(OWNER), 'notes', 'does-not-exist')))
  })

  it('a note pointing at a deleted folder fails closed', async () => {
    await seedNote('n1', { folderId: 'gone', aclSource: 'folder' })
    await assertFails(getDoc(doc(db(OWNER), 'notes', 'n1')))
  })
})

describe('notes: write permissions', () => {
  it('editor can change content', async () => {
    await seedNote('n1', everyRole)
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: 'edited', updatedAt: ts() }))
  })

  it('viewer cannot change content', async () => {
    await seedNote('n1', everyRole)
    await assertFails(updateDoc(doc(db(VIEWER), 'notes', 'n1'), { markdown: 'nope', updatedAt: ts() }))
  })

  it('link-view cannot change content', async () => {
    await seedNote('n1', { access: 'link-view' })
    await assertFails(updateDoc(doc(db(STRANGER), 'notes', 'n1'), { markdown: 'nope', updatedAt: ts() }))
  })

  it('link-edit can change content', async () => {
    await seedNote('n1', { access: 'link-edit' })
    await assertSucceeds(updateDoc(doc(db(STRANGER), 'notes', 'n1'), { markdown: 'ok', updatedAt: ts() }))
  })

  it('editor cannot change members', async () => {
    await seedNote('n1', everyRole)
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), {
        memberIds: [OWNER, EDITOR, VIEWER, STRANGER],
        roles: { ...everyRole.roles, [STRANGER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('editor cannot promote a viewer to editor', async () => {
    await seedNote('n1', everyRole)
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), {
        roles: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('viewer cannot promote themselves', async () => {
    await seedNote('n1', everyRole)
    await assertFails(
      updateDoc(doc(db(VIEWER), 'notes', 'n1'), {
        roles: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('editor cannot hijack ownership or createdAt', async () => {
    await seedNote('n1', everyRole)
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { ownerId: EDITOR, updatedAt: ts() }))
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { createdAt: new Date(0), updatedAt: ts() }))
  })

  it('owner adds a viewer and an editor', async () => {
    await seedNote('n1')
    await assertSucceeds(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        memberIds: [OWNER, EDITOR, VIEWER],
        roles: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'viewer' },
        updatedAt: ts(),
      })
    )
  })

  it('owner can share by read-only link', async () => {
    await seedNote('n1')
    await assertSucceeds(updateDoc(doc(db(OWNER), 'notes', 'n1'), { access: 'link-view', updatedAt: ts() }))
  })

  it('owner cannot demote themselves', async () => {
    await seedNote('n1')
    await assertFails(updateDoc(doc(db(OWNER), 'notes', 'n1'), { roles: { [OWNER]: 'editor' }, updatedAt: ts() }))
  })

  it('removing a member takes effect immediately', async () => {
    await seedNote('n1', everyRole)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'notes', 'n1'), {
        memberIds: [OWNER, VIEWER],
        roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
      })
    })
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: 'late', updatedAt: ts() }))
  })
})

describe('notes: folder revocation is immediate', () => {
  it('revoking the folder cuts write access without touching the note', async () => {
    await seedFolder('f1', everyRole)
    await seedNote('n1', { folderId: 'f1', aclSource: 'folder', ...everyRole })

    await assertSucceeds(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: 'before', updatedAt: ts() }))

    // Owner switches the folder to read-only for editors.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'folders', 'f1'), {
        roles: { [OWNER]: 'owner', [EDITOR]: 'viewer', [VIEWER]: 'viewer' },
      })
    })

    await assertSucceeds(getDoc(doc(db(EDITOR), 'notes', 'n1')))
    await assertFails(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { markdown: 'after', updatedAt: ts() }))
  })

  it('any folder writer may resync an inherited note ACL copy', async () => {
    await seedFolder('f1', everyRole)
    await seedNote('n1', { folderId: 'f1', aclSource: 'folder', ...everyRole })

    // The folder owner widens sharing to link-read.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'folders', 'f1'), { access: 'link-view' })
    })

    await assertSucceeds(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), { access: 'link-view', updatedAt: ts() })
    )
  })

  it('a resync cannot sneak in members the folder does not have', async () => {
    await seedFolder('f1', everyRole)
    await seedNote('n1', { folderId: 'f1', aclSource: 'folder', ...everyRole })
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1'), {
        memberIds: [OWNER, EDITOR, VIEWER, STRANGER],
        roles: { ...everyRole.roles, [STRANGER]: 'editor' },
        updatedAt: ts(),
      })
    )
  })

  it('a legacy note without aclSource keeps working', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', 'legacy'), {
        ownerId: OWNER,
        memberIds: [OWNER],
        roles: { [OWNER]: 'owner' },
        access: 'restricted',
        title: 'old',
        markdown: 'old',
        createdAt: ts(),
        updatedAt: ts(),
      })
    })
    await assertSucceeds(updateDoc(doc(db(OWNER), 'notes', 'legacy'), { markdown: 'new', updatedAt: ts() }))
  })

  it('a note cannot claim an ACL that its folder does not have', async () => {
    await seedFolder('f1', everyRole)
    await seedNote('n1', { folderId: 'f1', aclSource: 'folder', ...everyRole })
    await assertFails(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        memberIds: [OWNER],
        roles: { [OWNER]: 'owner' },
        updatedAt: ts(),
      })
    )
  })
})

describe('notes: delete', () => {
  it('owner deletes', async () => {
    await seedNote('n1', everyRole)
    await assertSucceeds(deleteDoc(doc(db(OWNER), 'notes', 'n1')))
  })

  it('editor and viewer cannot delete', async () => {
    await seedNote('n1', everyRole)
    await assertFails(deleteDoc(doc(db(EDITOR), 'notes', 'n1')))
    await assertFails(deleteDoc(doc(db(VIEWER), 'notes', 'n1')))
  })
})

describe('folders', () => {
  it('owner creates a private folder', async () => {
    await assertSucceeds(setDoc(doc(db(OWNER), 'folders', 'f1'), folderDoc()))
  })

  it('cannot create a folder with inherited ACL or foreign owner', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'folders', 'f1'), folderDoc({ ...everyRole })))
    await assertFails(setDoc(doc(db(EDITOR), 'folders', 'f1'), folderDoc()))
  })

  it('member can read, non-member cannot', async () => {
    await seedFolder('f1', everyRole)
    await assertSucceeds(getDoc(doc(db(VIEWER), 'folders', 'f1')))
    await assertFails(getDoc(doc(db(STRANGER), 'folders', 'f1')))
  })

  it('link-view folder is readable by link, not writable', async () => {
    await seedFolder('f1', { access: 'link-view' })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'folders', 'f1')))
    await assertFails(updateDoc(doc(db(STRANGER), 'folders', 'f1'), { name: 'x', updatedAt: ts() }))
  })

  it('editor can rename but not reshare', async () => {
    await seedFolder('f1', everyRole)
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'folders', 'f1'), { name: 'Nuevo', updatedAt: ts() }))
    await assertFails(
      updateDoc(doc(db(EDITOR), 'folders', 'f1'), {
        memberIds: [OWNER, EDITOR, VIEWER, STRANGER],
        roles: { ...everyRole.roles, [STRANGER]: 'editor' },
        updatedAt: ts(),
      })
    )
    await assertFails(updateDoc(doc(db(EDITOR), 'folders', 'f1'), { access: 'link-edit', updatedAt: ts() }))
  })

  it('viewer cannot rename', async () => {
    await seedFolder('f1', everyRole)
    await assertFails(updateDoc(doc(db(VIEWER), 'folders', 'f1'), { name: 'x', updatedAt: ts() }))
  })

  it('owner shares the folder read-only', async () => {
    await seedFolder('f1', everyRole)
    await assertSucceeds(updateDoc(doc(db(OWNER), 'folders', 'f1'), { access: 'link-view', updatedAt: ts() }))
  })

  it('only the owner deletes the folder', async () => {
    await seedFolder('f1', everyRole)
    await assertFails(deleteDoc(doc(db(EDITOR), 'folders', 'f1')))
    await assertSucceeds(deleteDoc(doc(db(OWNER), 'folders', 'f1')))
  })
})

describe('collaboration sub-collections respect roles', () => {
  const block = (overrides: Record<string, unknown> = {}) => ({
    v: 1,
    jid: 1,
    hash: '0123456789ab',
    bytes: 3,
    data: 'AQID',
    clientId: 1,
    createdAt: ts(),
    ...overrides,
  })

  it('editor appends blocks, viewer cannot, both can read', async () => {
    await seedNote('n1', everyRole)
    await assertFails(addDoc(collection(db(VIEWER), 'notes', 'n1', 'updates'), block()))
    await assertSucceeds(addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block()))
    await assertSucceeds(getDocs(collection(db(VIEWER), 'notes', 'n1', 'updates')))
  })

  it('rejects a block without a content hash', async () => {
    await seedNote('n1', everyRole)
    const { hash: _hash, ...noHash } = block()
    await assertFails(addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), noHash))
  })

  it('rejects a malformed hash', async () => {
    await seedNote('n1', everyRole)
    await assertFails(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block({ hash: 'NOT-A-HASH' }))
    )
  })

  it('rejects an unknown block version', async () => {
    await seedNote('n1', everyRole)
    await assertFails(addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block({ v: 2 })))
  })

  it('rejects non-positive jids and oversized blocks', async () => {
    await seedNote('n1', everyRole)
    await assertFails(addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block({ jid: 0 })))
    await assertFails(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block({ bytes: 500_001 }))
    )
    await assertFails(
      addDoc(collection(db(EDITOR), 'notes', 'n1', 'updates'), block({ data: 'A'.repeat(620_001) }))
    )
  })

  it('blocks are immutable, editors can prune them', async () => {
    await seedNote('n1', everyRole)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', 'n1', 'updates', 'b1'), block())
    })
    await assertFails(
      updateDoc(doc(db(EDITOR), 'notes', 'n1', 'updates', 'b1'), { data: 'BAUG', createdAt: ts() })
    )
    await assertSucceeds(deleteDoc(doc(db(EDITOR), 'notes', 'n1', 'updates', 'b1')))
  })

  it('manifest carries the snapshot and is writable by editors only', async () => {
    await seedNote('n1', everyRole)
    const manifest = {
      epoch: 1,
      snapshot: 'AQID',
      stateVector: 'AQID',
      jid: 12,
      bytes: 3,
      clientId: 1,
      updatedAt: ts(),
    }
    await assertFails(
      setDoc(doc(db(VIEWER), 'notes', 'n1', 'collab', 'manifest'), manifest)
    )
    await assertSucceeds(
      setDoc(doc(db(EDITOR), 'notes', 'n1', 'collab', 'manifest'), manifest)
    )
    await assertFails(
      setDoc(doc(db(EDITOR), 'notes', 'n1', 'collab', 'manifest'), { ...manifest, epoch: 2 })
    )
    await assertFails(
      setDoc(doc(db(EDITOR), 'notes', 'n1', 'collab', 'manifest'), {
        ...manifest,
        snapshot: 'A'.repeat(900_001),
      })
    )
  })

  it('the v1 state document is read-only for readers and deletable for writers', async () => {
    await seedNote('n1', everyRole)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notes', 'n1', 'collab', 'state'), {
        state: 'AQID',
        clientId: 1,
        updatedAt: ts(),
      })
    })
    await assertSucceeds(getDoc(doc(db(VIEWER), 'notes', 'n1', 'collab', 'state')))
    await assertSucceeds(deleteDoc(doc(db(EDITOR), 'notes', 'n1', 'collab', 'state')))
  })

  it('viewers cannot write presence, editors can', async () => {
    await seedNote('n1', everyRole)
    const presence = (uid: string) => ({
      userId: uid,
      clientId: 7,
      name: 'x',
      color: '#fff',
      cursor: 'AQID',
      selection: 'AQID',
      updatedAt: ts(),
    })
    await assertFails(setDoc(doc(db(VIEWER), 'notes', 'n1', 'presence', VIEWER), presence(VIEWER)))
    await assertSucceeds(setDoc(doc(db(EDITOR), 'notes', 'n1', 'presence', EDITOR), presence(EDITOR)))
  })

  it('stranger cannot write blocks on a restricted note', async () => {
    await seedNote('n1')
    await assertFails(addDoc(collection(db(STRANGER), 'notes', 'n1', 'updates'), block()))
  })
})

describe('userIndex', () => {
  const hash = 'a'.repeat(64)
  const entry = { uid: OWNER, email: 'a@b.com', name: 'Ana', updatedAt: ts() }

  it('user can publish their own entry', async () => {
    await assertSucceeds(setDoc(doc(db(OWNER), 'userIndex', hash), entry))
  })

  it('cannot publish an entry for somebody else', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'userIndex', hash), entry))
  })

  it('signed-in users can read an entry by id', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'userIndex', hash), entry)
    })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'userIndex', hash)))
  })

  it('the directory cannot be listed', async () => {
    await assertFails(getDocs(collection(db(STRANGER), 'userIndex')))
  })

  it('the id must be a sha256 hex digest', async () => {
    await assertFails(setDoc(doc(db(OWNER), 'userIndex', 'ana@b.com'), entry))
  })
})

describe('profiles', () => {
  it('any signed-in user can read a profile', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'profiles', OWNER), { name: 'Ana', updatedAt: ts() })
    })
    await assertSucceeds(getDoc(doc(db(STRANGER), 'profiles', OWNER)))
  })

  it('a user can only write their own profile', async () => {
    await assertSucceeds(setDoc(doc(db(OWNER), 'profiles', OWNER), { name: 'Ana', updatedAt: ts() }))
    await assertFails(setDoc(doc(db(EDITOR), 'profiles', OWNER), { name: 'Fake', updatedAt: ts() }))
  })

  it('anonymous cannot read profiles', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'profiles', OWNER), { name: 'Ana', updatedAt: ts() })
    })
    await assertFails(getDoc(doc(db(), 'profiles', OWNER)))
  })
})

describe('tags', () => {
  it('a note can carry a bounded tag list', async () => {
    await seedNote('n1')
    await assertSucceeds(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        tags: ['trabajo', 'clientes/acme'],
        updatedAt: ts(),
      })
    )
  })

  it('rejects a tag field that is not a list, or is too long', async () => {
    await seedNote('n1')
    await assertFails(updateDoc(doc(db(OWNER), 'notes', 'n1'), { tags: 'trabajo', updatedAt: ts() }))
    await assertFails(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        tags: Array.from({ length: 31 }, (_, i) => `t${i}`),
        updatedAt: ts(),
      })
    )
  })

  it('a viewer cannot tag a note, an editor can', async () => {
    await seedNote('n1', everyRole)
    await assertFails(updateDoc(doc(db(VIEWER), 'notes', 'n1'), { tags: ['x'], updatedAt: ts() }))
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'notes', 'n1'), { tags: ['x'], updatedAt: ts() }))
  })

  it('folders accept tags from their editor without unlocking sharing', async () => {
    await seedFolder('f1', everyRole)
    await assertSucceeds(
      updateDoc(doc(db(EDITOR), 'folders', 'f1'), { tags: ['equipo'], updatedAt: ts() })
    )
    await assertFails(
      updateDoc(doc(db(EDITOR), 'folders', 'f1'), { access: 'link-view', updatedAt: ts() })
    )
  })

  it('tagging does not require a paid plan', async () => {
    await grantPaid(OWNER, 'free')
    await seedNote('n1')
    await assertSucceeds(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), { tags: ['gratis'], updatedAt: ts() })
    )
  })
})

describe('plans gate sharing', () => {
  it('a free owner cannot change the ACL of a note', async () => {
    await grantPaid(OWNER, 'free')
    await seedNote('n1')
    await assertFails(updateDoc(doc(db(OWNER), 'notes', 'n1'), { access: 'link-view', updatedAt: ts() }))
    await assertFails(
      updateDoc(doc(db(OWNER), 'notes', 'n1'), {
        memberIds: [OWNER, VIEWER],
        roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
        updatedAt: ts(),
      })
    )
  })

  it('a free owner can still edit content and the title', async () => {
    await grantPaid(OWNER, 'free')
    await seedNote('n1')
    await assertSucceeds(updateDoc(doc(db(OWNER), 'notes', 'n1'), { markdown: 'nuevo', updatedAt: ts() }))
    await assertSucceeds(updateDoc(doc(db(OWNER), 'notes', 'n1'), { title: 'Otro', updatedAt: ts() }))
  })

  it('a free owner cannot reshare a folder, but can rename it', async () => {
    await grantPaid(OWNER, 'free')
    await seedFolder('f1')
    await assertFails(updateDoc(doc(db(OWNER), 'folders', 'f1'), { access: 'link-view', updatedAt: ts() }))
    await assertSucceeds(updateDoc(doc(db(OWNER), 'folders', 'f1'), { name: 'Nuevo', updatedAt: ts() }))
  })

  it('an expired plan behaves like free', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'entitlements', OWNER), {
        plan: 'paid',
        source: 'test',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
        updatedAt: ts(),
      })
    })
    await seedNote('n1')
    await assertFails(updateDoc(doc(db(OWNER), 'notes', 'n1'), { access: 'link-view', updatedAt: ts() }))
  })

  it('a client cannot grant itself a plan', async () => {
    await assertFails(
      setDoc(doc(db(VIEWER), 'entitlements', VIEWER), {
        plan: 'paid',
        source: 'self',
        expiresAt: null,
        updatedAt: ts(),
      })
    )
    await assertFails(
      setDoc(doc(db(OWNER), 'entitlements', OWNER), {
        plan: 'paid',
        source: 'self',
        expiresAt: null,
        updatedAt: ts(),
      })
    )
  })

  it('only an admin can grant a plan', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins', OWNER), { createdAt: ts() })
    })
    await assertSucceeds(
      setDoc(doc(db(OWNER), 'entitlements', EDITOR), {
        plan: 'paid',
        source: 'manual',
        expiresAt: null,
        updatedAt: ts(),
      })
    )
    await assertFails(
      setDoc(doc(db(EDITOR), 'entitlements', VIEWER), {
        plan: 'paid',
        source: 'manual',
        expiresAt: null,
        updatedAt: ts(),
      })
    )
  })

  it('users can read their own entitlement but not somebody else\'s', async () => {
    await assertSucceeds(getDoc(doc(db(OWNER), 'entitlements', OWNER)))
    await assertFails(getDoc(doc(db(VIEWER), 'entitlements', OWNER)))
  })
})

describe('analytics events', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    name: 'app_open',
    props: { platform: 'web' },
    at: ts(),
    ...overrides,
  })

  it('a user can log a known event on their own path', async () => {
    await assertSucceeds(addDoc(collection(db(OWNER), 'analytics', OWNER, 'events'), event()))
  })

  it('rejects unknown event names and foreign paths', async () => {
    await assertFails(
      addDoc(collection(db(OWNER), 'analytics', OWNER, 'events'), event({ name: 'paid_upgrade' }))
    )
    await assertFails(addDoc(collection(db(EDITOR), 'analytics', OWNER, 'events'), event()))
  })

  it('rejects oversized props maps and events are immutable', async () => {
    await assertFails(
      addDoc(
        collection(db(OWNER), 'analytics', OWNER, 'events'),
        event({ props: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' } })
      )
    )
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'analytics', OWNER, 'events', 'e1'), event())
    })
    await assertFails(deleteDoc(doc(db(OWNER), 'analytics', OWNER, 'events', 'e1')))
  })
})

describe('legacy v1 schema', () => {
  it('owner can read old notes, writes are frozen', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'notes', 'old1'), { title: 'old' })
    })
    await assertSucceeds(getDoc(doc(db(OWNER), 'users', OWNER, 'notes', 'old1')))
    await assertFails(updateDoc(doc(db(OWNER), 'users', OWNER, 'notes', 'old1'), { title: 'x' }))
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
