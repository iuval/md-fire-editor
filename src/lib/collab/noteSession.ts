import * as Y from 'yjs'
import { FirestoreAwareness, type CollabUser } from './awareness'
import { FirestoreYjsProvider } from './provider'
import { YCanvas } from '../canvas/yCanvas'

/**
 * One note, one document, many views.
 *
 * Two panes can show the same note, but they must not each build their own Yjs
 * document: two independent docs seeding the same content would insert it twice
 * and two providers would fight over the same Firestore blocks. So the document,
 * its transport and its presence channel are shared by every editor that shows
 * it, and the last view destroys them.
 *
 * Views are counted by an owner id (a React `useId`), not by calls: acquiring
 * twice with the same owner is a no-op, so a double-invoked initializer cannot
 * leak a view that nobody releases.
 */
export interface NoteSession {
  readonly noteId: string
  readonly doc: Y.Doc
  readonly provider: FirestoreYjsProvider
  readonly awareness: FirestoreAwareness
  /**
   * The canvas binding for this document, created on first use. It lives as
   * long as the document does: one per note, shared by every pane showing it
   * (two bindings would double observers and double the save writes).
   */
  readonly canvas: YCanvas
  /**
   * True for exactly one view. Seeding content is a one-time job: a second
   * editor must render what the document already has.
   */
  claimSeed(owner?: string): boolean
  /**
   * True for the one view allowed to write *external* content (agent CLI,
   * another device) into the shared document. Every other view only renders it.
   */
  isPrimary(owner: string): boolean
  /** Drops one view. The last one destroys the transport. */
  release(owner: string): void
}

interface Entry {
  owners: Set<string>
  session: NoteSession
}

const entries = new Map<string, Entry>()

function keyOf(uid: string, noteId: string): string {
  return `${uid}\u0000${noteId}`
}

export function acquireNoteSession(
  noteId: string,
  uid: string,
  user: CollabUser,
  owner: string
): NoteSession {
  const key = keyOf(uid, noteId)
  const existing = entries.get(key)
  if (existing) {
    existing.owners.add(owner)
    return existing.session
  }

  const doc = new Y.Doc()
  const provider = new FirestoreYjsProvider(noteId, doc)
  const awareness = new FirestoreAwareness(noteId, uid, user, doc)
  let seedAvailable = true
  let primary: string | null = null
  let canvas: YCanvas | null = null

  const entry: Entry = {
    owners: new Set([owner]),
    session: {
      noteId,
      doc,
      provider,
      awareness,
      get canvas() {
        canvas ??= new YCanvas(doc)
        return canvas
      },
      claimSeed: (owner?: string) => {
        if (!seedAvailable) return false
        seedAvailable = false
        if (owner) primary = owner
        return true
      },
      isPrimary: (owner: string) => primary === owner,
      release: (who: string) => {
        if (!entry.owners.delete(who)) return
        // The view that seeded the document owns external writes; if it goes
        // away, hand that job to one remaining view instead of losing it.
        if (primary === who) primary = entry.owners.values().next().value ?? null
        if (entry.owners.size > 0) return
        entries.delete(key)
        canvas?.destroy()
        awareness.destroy()
        provider.destroy()
        doc.destroy()
      },
    },
  }

  entries.set(key, entry)
  provider.connect()
  awareness.connect()
  return entry.session
}

/** Test seam: how many notes currently hold a live transport. */
export function liveNoteSessions(): number {
  return entries.size
}
