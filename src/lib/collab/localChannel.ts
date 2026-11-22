/**
 * Same-browser fast lane for Yjs updates.
 *
 * Firestore is the durable transport, but it cannot hand this tab's write to
 * the *other* tab of the same account faster than a network round trip plus the
 * flush window. `BroadcastChannel` does it in the same tick, for free and with
 * no server, so two windows on one machine feel instantaneous. Collaboration
 * across devices still travels through Firestore: this is a lane, not a
 * replacement, and it is inert where `BroadcastChannel` does not exist.
 *
 * Only updates are shared here. Presence is not: two tabs of one account are
 * the same user, and a second caret in your own colour is noise.
 */
export interface BroadcastLike {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(data: unknown): void
  close(): void
}

export interface LocalUpdate {
  noteId: string
  /** The sender's Yjs client id, so a tab can ignore what it already applied. */
  clientId: number
  /** base64 Yjs update, same encoding the blocks use. */
  data: string
}

export interface LocalChannel {
  post(update: LocalUpdate): void
  onMessage(listener: (update: LocalUpdate) => void): void
  close(): void
}

export type LocalChannelFactory = () => BroadcastLike | null

const CHANNEL_NAME = 'firemd-collab'

function defaultFactory(): BroadcastLike | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    // The DOM type forbids the narrower `{ data: unknown }` handler; the cast
    // keeps the seam testable without widening the public type.
    return new BroadcastChannel(CHANNEL_NAME) as unknown as BroadcastLike
  } catch {
    return null
  }
}

/** One channel per note session, or `null` when the browser has none. */
export function openLocalChannel(
  noteId: string,
  clientId: number,
  factory: LocalChannelFactory = defaultFactory
): LocalChannel | null {
  let channel: BroadcastLike | null
  try {
    channel = factory()
  } catch {
    return null
  }
  if (!channel) return null

  const listeners = new Set<(update: LocalUpdate) => void>()
  const opened = channel

  opened.onmessage = (event) => {
    const update = event?.data as Partial<LocalUpdate> | null | undefined
    if (!update || typeof update.data !== 'string') return
    if (typeof update.clientId !== 'number') return
    if (update.noteId !== noteId || update.clientId === clientId) return
    listeners.forEach((listener) => listener(update as LocalUpdate))
  }

  return {
    post(update) {
      try {
        opened.postMessage(update)
      } catch {
        // A closed channel is not an editing problem.
      }
    },
    onMessage(listener) {
      listeners.add(listener)
    },
    close() {
      listeners.clear()
      opened.onmessage = null
      try {
        opened.close()
      } catch {
        // Already closed.
      }
    },
  }
}
