import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { base64ToBytes, base64ToJson, bytesToBase64, jsonToBase64 } from '../src/lib/collab/encoding'
import {
  canReadAcl,
  canWriteAcl,
  effectiveAcl,
  isAclOwner,
  noteCanEdit,
  noteCanRead,
  roleOf,
  toNote,
  type Folder,
  type Note,
} from '../src/lib/notes'

describe('encoding helpers', () => {
  it('round-trips binary updates', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips JSON payloads', () => {
    const value = { type: 'item', assoc: 0, item: { client: 1234, clock: 7 } }
    expect(base64ToJson(jsonToBase64(value))).toEqual(value)
  })

  it('returns null for malformed payloads', () => {
    expect(base64ToJson('not-base64-$$$')).toBeNull()
  })
})

describe('Yjs convergence (what makes simultaneous editing safe)', () => {
  it('merges concurrent edits from two clients without losing text', () => {
    const alice = new Y.Doc()
    const bob = new Y.Doc()

    alice.getText('content').insert(0, 'Hola mundo')
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice))

    // Both edit at the same time, before seeing each other.
    alice.getText('content').insert(11, ' desde A')
    bob.getText('content').insert(0, 'B: ')

    const aliceUpdate = Y.encodeStateAsUpdate(alice)
    const bobUpdate = Y.encodeStateAsUpdate(bob)
    Y.applyUpdate(alice, bobUpdate)
    Y.applyUpdate(bob, aliceUpdate)

    expect(alice.getText('content').toString()).toBe(bob.getText('content').toString())
    const merged = alice.getText('content').toString()
    expect(merged).toContain('B: ')
    expect(merged).toContain(' desde A')
  })

  it('is idempotent when an update is delivered twice', () => {
    const source = new Y.Doc()
    const target = new Y.Doc()
    source.getText('content').insert(0, 'uno dos')
    const update = Y.encodeStateAsUpdate(source)

    Y.applyUpdate(target, update)
    Y.applyUpdate(target, update)

    expect(target.getText('content').toString()).toBe('uno dos')
  })

  it('converges when a snapshot and the update log are both applied', () => {
    const live = new Y.Doc()
    const late = new Y.Doc()

    const t = live.getText('content')
    t.insert(0, 'base ')
    const snapshot = Y.encodeStateAsUpdate(live)

    t.insert(t.length, 'edit-1 ')
    const updateOne = Y.encodeStateAsUpdate(live, Y.encodeStateVector(new Y.Doc()))

    t.insert(t.length, 'edit-2')
    const updateTwo = Y.encodeStateAsUpdate(live)

    // A client that was offline replays: snapshot first, then the log.
    Y.applyUpdate(late, snapshot)
    Y.applyUpdate(late, updateOne)
    Y.applyUpdate(late, updateTwo)

    expect(late.getText('content').toString()).toBe(t.toString())
  })
})

describe('ACL helpers', () => {
  const acl = {
    memberIds: ['owner', 'editor', 'viewer'],
    roles: { owner: 'owner', editor: 'editor', viewer: 'viewer' } as Record<string, 'owner' | 'editor' | 'viewer'>,
    access: 'restricted' as const,
  }

  it('maps roles', () => {
    expect(roleOf(acl, 'owner')).toBe('owner')
    expect(roleOf(acl, 'viewer')).toBe('viewer')
    expect(roleOf(acl, 'stranger')).toBeNull()
    expect(roleOf(acl, undefined)).toBeNull()
  })

  it('everything with a role can read', () => {
    expect(canReadAcl(acl, 'viewer')).toBe(true)
    expect(canReadAcl(acl, 'stranger')).toBe(false)
    expect(canReadAcl(acl, undefined)).toBe(false)
  })

  it('only owner and editor can write', () => {
    expect(canWriteAcl(acl, 'owner')).toBe(true)
    expect(canWriteAcl(acl, 'editor')).toBe(true)
    expect(canWriteAcl(acl, 'viewer')).toBe(false)
  })

  it('link-view reads but never writes, link-edit writes', () => {
    const reader = { ...acl, memberIds: ['owner'], roles: { owner: 'owner' as const }, access: 'link-view' as const }
    expect(canReadAcl(reader, 'whoever')).toBe(true)
    expect(canWriteAcl(reader, 'whoever')).toBe(false)

    const writer = { ...reader, access: 'link-edit' as const }
    expect(canWriteAcl(writer, 'whoever')).toBe(true)
    expect(isAclOwner(writer, 'whoever')).toBe(false)
  })

  it('anonymous visitors never read or write', () => {
    expect(canReadAcl({ ...acl, access: 'link-edit' }, undefined)).toBe(false)
    expect(canWriteAcl({ ...acl, access: 'link-edit' }, undefined)).toBe(false)
  })
})

describe('folder inheritance', () => {
  const folder: Folder = {
    id: 'f1',
    ownerId: 'owner',
    name: 'Equipo',
    memberIds: ['owner', 'editor', 'viewer'],
    roles: { owner: 'owner', editor: 'editor', viewer: 'viewer' },
    access: 'restricted',
  }

  const inherited: Note = {
    id: 'n1',
    ownerId: 'editor',
    folderId: 'f1',
    aclSource: 'folder',
    memberIds: ['owner'],
    roles: { owner: 'owner' },
    access: 'restricted',
    title: 'x',
    markdown: '',
    version: 1,
  }

  it('resolves permissions from the folder, not from the stale copy', () => {
    const resolved = effectiveAcl(inherited, [folder])
    expect(canWriteAcl(resolved, 'editor')).toBe(true)
    expect(canReadAcl(resolved, 'viewer')).toBe(true)
    expect(canWriteAcl(resolved, 'viewer')).toBe(false)
    expect(noteCanEdit(inherited, [folder], 'viewer')).toBe(false)
    expect(noteCanRead(inherited, [folder], 'stranger')).toBe(false)
  })

  it('fails closed when the folder is gone', () => {
    const resolved = effectiveAcl(inherited, [])
    expect(canReadAcl(resolved, 'editor')).toBe(false)
    expect(noteCanEdit(inherited, [], 'editor')).toBe(false)
  })

  it('own-ACL notes ignore folders entirely', () => {
    const own: Note = { ...inherited, aclSource: 'own', folderId: 'f1' }
    expect(effectiveAcl(own, [folder]).memberIds).toEqual(['owner'])
  })

  it('normalizes raw Firestore documents', () => {
    const note = toNote('abc', { ownerId: 'u', title: 't', roles: { u: 'owner' } })
    expect(note.memberIds).toEqual([])
    expect(note.aclSource).toBe('own')
    expect(note.folderId).toBeNull()
    expect(note.access).toBe('restricted')
  })
})
