// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { FirestoreYjsProvider } from '../src/lib/collab/provider'
import type { BroadcastLike, LocalChannelFactory } from '../src/lib/collab/localChannel'

interface FakeChannel extends BroadcastLike {
  closed: boolean
}

/** A `BroadcastChannel` stand-in: delivers to every channel but the sender. */
function createBus() {
  const channels: FakeChannel[] = []
  const seen: unknown[] = []

  const factory: LocalChannelFactory = () => {
    const channel: FakeChannel = {
      onmessage: null,
      closed: false,
      postMessage(data) {
        seen.push(data)
        for (const other of channels) {
          if (other === channel || other.closed) continue
          other.onmessage?.({ data })
        }
      },
      close() {
        channel.closed = true
        channel.onmessage = null
      },
    }
    channels.push(channel)
    return channel
  }

  return { factory, seen, channels }
}

describe('same-browser hot path', () => {
  // Two windows of the same account are two tabs, and Firestore cannot hand a
  // write back to the other tab faster than a round trip. BroadcastChannel can,
  // in the same tick, for free.
  it('delivers an edit to another tab without waiting for the round trip', () => {
    const bus = createBus()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new FirestoreYjsProvider('n1', docA, null, bus.factory)
    const b = new FirestoreYjsProvider('n1', docB, null, bus.factory)

    a.connect()
    b.connect()
    docA.getText('content').insert(0, 'hola')

    expect(docB.getText('content').toString()).toBe('hola')

    a.destroy()
    b.destroy()
    docA.destroy()
    docB.destroy()
  })

  it('keeps converging when both tabs type at the same time', () => {
    const bus = createBus()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new FirestoreYjsProvider('n1', docA, null, bus.factory)
    const b = new FirestoreYjsProvider('n1', docB, null, bus.factory)

    a.connect()
    b.connect()
    docA.getText('content').insert(0, 'de A')
    docB.getText('content').insert(0, 'de B ')

    expect(docA.getText('content').toString()).toBe(docB.getText('content').toString())

    a.destroy()
    b.destroy()
    docA.destroy()
    docB.destroy()
  })

  it('does not echo an applied remote update back onto the channel', () => {
    const bus = createBus()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new FirestoreYjsProvider('n1', docA, null, bus.factory)
    const b = new FirestoreYjsProvider('n1', docB, null, bus.factory)

    a.connect()
    b.connect()
    docA.getText('content').insert(0, 'x')

    // One edit, one message: the receiving tab must not rebroadcast it forever.
    expect(bus.seen).toHaveLength(1)

    a.destroy()
    b.destroy()
    docA.destroy()
    docB.destroy()
  })

  it('ignores messages that belong to a different note', () => {
    const bus = createBus()
    const docA = new Y.Doc()
    const docOther = new Y.Doc()
    const a = new FirestoreYjsProvider('n1', docA, null, bus.factory)
    const other = new FirestoreYjsProvider('n2', docOther, null, bus.factory)

    a.connect()
    other.connect()
    docA.getText('content').insert(0, 'no me copies')

    expect(docOther.getText('content').toString()).toBe('')

    a.destroy()
    other.destroy()
    docA.destroy()
    docOther.destroy()
  })

  it('closes its channel when the view goes away', () => {
    const bus = createBus()
    const doc = new Y.Doc()
    const provider = new FirestoreYjsProvider('n1', doc, null, bus.factory)
    provider.connect()
    provider.destroy()

    expect(bus.channels).toHaveLength(1)
    expect(bus.channels[0].closed).toBe(true)
    doc.destroy()
  })

  it('follows the browser losing and regaining its connection', () => {
    const doc = new Y.Doc()
    const provider = new FirestoreYjsProvider('n1', doc, null, createBus().factory)
    const offline: (boolean | undefined)[] = []
    provider.onStatus((s) => offline.push(s.offline))
    provider.connect()

    window.dispatchEvent(new Event('offline'))
    expect(offline.at(-1)).toBe(true)

    window.dispatchEvent(new Event('online'))
    expect(offline.at(-1)).toBe(false)

    provider.destroy()
    doc.destroy()
  })

  // No Firebase means no server, not no editor: a local lane must still work,
  // and the status must say why the cloud is missing.
  it('reports the missing backend as offline instead of an error', () => {
    const doc = new Y.Doc()
    const provider = new FirestoreYjsProvider('n1', doc, null, createBus().factory)
    const states: { offline?: boolean; error: string | null }[] = []
    provider.onStatus((s) => states.push({ offline: s.offline, error: s.error }))
    provider.connect()

    expect(states.at(-1)?.offline).toBe(true)
    expect(states.at(-1)?.error).toBe('Firebase no está configurado')
    provider.destroy()
    doc.destroy()
  })
})
