import { describe, expect, it } from 'vitest'
import { acquireNoteSession, liveNoteSessions } from '../src/lib/collab/noteSession'

const user = { name: 'Ana', color: '#a84e00' }

describe('note sessions', () => {
  it('shares one document between two views of the same note', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    const second = acquireNoteSession('n1', 'u1', user, 'view-b')

    expect(second).toBe(first)
    expect(second.doc).toBe(first.doc)
    expect(second.provider).toBe(first.provider)
    expect(second.awareness).toBe(first.awareness)
    expect(liveNoteSessions()).toBe(1)

    first.release('view-a')
    second.release('view-b')
    expect(liveNoteSessions()).toBe(0)
  })

  it('keeps the transport alive until the last view goes away', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    const second = acquireNoteSession('n1', 'u1', user, 'view-b')

    first.release('view-a')
    expect(liveNoteSessions()).toBe(1)
    expect(second.doc.isDestroyed).toBe(false)

    second.release('view-b')
    expect(liveNoteSessions()).toBe(0)
    expect(second.doc.isDestroyed).toBe(true)
  })

  it('counts each view once, however often it acquires', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    acquireNoteSession('n1', 'u1', user, 'view-a')

    first.release('view-a')
    expect(liveNoteSessions()).toBe(0)
    // A second release from the same owner is a no-op, not a negative count.
    first.release('view-a')
    expect(liveNoteSessions()).toBe(0)
  })

  it('builds a fresh document after the last view released', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    first.release('view-a')

    const again = acquireNoteSession('n1', 'u1', user, 'view-a')
    expect(again.doc).not.toBe(first.doc)
    expect(again.doc.isDestroyed).toBe(false)
    again.release('view-a')
  })

  it('only lets one view seed the document', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    const second = acquireNoteSession('n1', 'u1', user, 'view-b')

    expect(first.claimSeed()).toBe(true)
    expect(second.claimSeed()).toBe(false)
    expect(first.claimSeed()).toBe(false)

    first.release('view-a')
    second.release('view-b')
  })

  it('lets only one view write external content, and hands the job over', () => {
    const first = acquireNoteSession('n1', 'u1', user, 'view-a')
    const second = acquireNoteSession('n1', 'u1', user, 'view-b')

    expect(first.claimSeed('view-a')).toBe(true)
    expect(first.isPrimary('view-a')).toBe(true)
    expect(second.isPrimary('view-b')).toBe(false)

    // The primary pane closes: the surviving view takes over instead of leaving
    // external writes unapplied.
    first.release('view-a')
    expect(second.isPrimary('view-b')).toBe(true)

    second.release('view-b')
    expect(liveNoteSessions()).toBe(0)
  })

  it('separates notes and users', () => {
    const a = acquireNoteSession('n1', 'u1', user, 'view-a')
    const b = acquireNoteSession('n2', 'u1', user, 'view-a')
    const c = acquireNoteSession('n1', 'u2', user, 'view-a')

    expect(b.doc).not.toBe(a.doc)
    expect(c.doc).not.toBe(a.doc)
    expect(liveNoteSessions()).toBe(3)

    a.release('view-a')
    b.release('view-a')
    c.release('view-a')
    expect(liveNoteSessions()).toBe(0)
  })
})
