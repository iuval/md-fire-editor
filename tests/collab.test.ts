import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { base64ToBytes, base64ToJson, bytesToBase64, jsonToBase64 } from '../src/lib/collab/encoding'
import { canEdit, isOwner, toNote, type Note } from '../src/lib/notes'

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

describe('note permission helpers', () => {
  const base: Note = {
    id: 'n1',
    ownerId: 'owner',
    memberIds: ['owner'],
    roles: { owner: 'owner' },
    access: 'restricted',
    title: 'x',
    markdown: '',
    version: 1,
  }

  it('owner can edit', () => {
    expect(canEdit(base, 'owner')).toBe(true)
    expect(isOwner(base, 'owner')).toBe(true)
  })

  it('stranger cannot edit a restricted note', () => {
    expect(canEdit(base, 'stranger')).toBe(false)
    expect(isOwner(base, 'stranger')).toBe(false)
  })

  it('member can edit but is not owner', () => {
    const shared: Note = { ...base, memberIds: ['owner', 'editor'], roles: { owner: 'owner', editor: 'editor' } }
    expect(canEdit(shared, 'editor')).toBe(true)
    expect(isOwner(shared, 'editor')).toBe(false)
  })

  it('any signed-in user can edit a link-edit note but none becomes owner', () => {
    const linked: Note = { ...base, access: 'link-edit' }
    expect(canEdit(linked, 'someone')).toBe(true)
    expect(isOwner(linked, 'someone')).toBe(false)
  })

  it('anonymous visitors can never edit', () => {
    expect(canEdit({ ...base, access: 'link-edit' }, undefined)).toBe(false)
  })

  it('normalizes raw Firestore documents', () => {
    const note = toNote('abc', { ownerId: 'u', title: 't', roles: { u: 'owner' } })
    expect(note.memberIds).toEqual([])
    expect(note.access).toBe('restricted')
    expect(note.version).toBe(0)
  })
})
