import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type * as Y from 'yjs'
import type { Firestore } from 'firebase/firestore'
import { db as defaultDb } from '../../firebase'
import { base64ToJson, jsonToBase64 } from './encoding'

export interface CollabUser {
  name: string
  color: string
}

export interface AwarenessUser extends CollabUser {
  uid: string
  clientId: number
}

// Presence is the cheapest thing to over-write and the least valuable to send
// often: a caret does not need 200 ms resolution. Measured cost, not taste.
//
// The heartbeat sets how long a closed tab keeps a ghost caret on screen, so it
// is a UX number as much as a cost one: one beat of 10 s plus margin bounds the
// ghost at 25 s instead of 50 s, at the price of 6 writes a minute instead of 3.
const HEARTBEAT_MS = 10_000
const WRITE_THROTTLE_MS = 1_200
const STALE_AFTER_MS = 25_000

/**
 * `y-protocols` Awareness-compatible object whose transport is a Firestore
 * `presence` sub-collection instead of a websocket. Only the subset used by
 * Tiptap's CollaborationCaret is implemented:
 *   clientID, getLocalState, setLocalStateField, getStates, on/off('update').
 */
export class FirestoreAwareness {
  readonly clientID: number
  /** Firestore writes and deletes this channel has issued, for the usage meter. */
  readonly stats = { writes: 0, deletes: 0 }
  private readonly noteId: string
  private readonly uid: string
  private readonly user: CollabUser
  private localState: Record<string, unknown> | null = null
  private states = new Map<number, Record<string, unknown>>()
  private users = new Map<string, AwarenessUser>()
  private listeners = new Set<(changes: unknown) => void>()
  private userListeners = new Set<(users: AwarenessUser[]) => void>()
  private unsub: (() => void) | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private lastSent = ''
  private lastSentAt = 0
  private hidden = false
  private onVisibility = () => {
    this.hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (!this.hidden) this.scheduleWrite()
  }
  /**
   * Closing a tab rarely unmounts the React tree, so `destroy()` alone left a
   * caret behind for the whole stale window. `pagehide` fires on close, on
   * back/forward cache and on mobile app switching.
   */
  private onPageHide = () => {
    this.remove()
  }
  /** Back/forward cache brought the page back: say hello again immediately. */
  private onPageShow = () => {
    if (!this.destroyed) void this.write({ force: true })
  }
  private destroyed = false
  private readonly fs: Firestore | null

  constructor(
    noteId: string,
    uid: string,
    user: CollabUser,
    ydoc: Y.Doc,
    firestore: Firestore | null = defaultDb
  ) {
    this.fs = firestore
    this.noteId = noteId
    this.uid = uid
    this.user = user
    this.clientID = ydoc.clientID
  }

  connect(): void {
    if (!this.fs || this.destroyed) return

    this.unsub = onSnapshot(
      collection(this.fs, 'notes', this.noteId, 'presence'),
      (snap) => {
        const nextStates = new Map<number, Record<string, unknown>>()
        const nextUsers = new Map<string, AwarenessUser>()
        snap.forEach((d) => {
          const data = d.data()
          const updatedAt = data.updatedAt?.toDate?.()?.getTime?.() ?? 0
          if (Date.now() - updatedAt > STALE_AFTER_MS) return
          if (data.userId === this.uid) return
          nextUsers.set(d.id, {
            uid: d.id,
            clientId: data.clientId,
            name: data.name,
            color: data.color,
          })
          nextStates.set(data.clientId, {
            user: { name: data.name, color: data.color },
            cursor: {
              anchor: base64ToJson(data.cursor),
              head: base64ToJson(data.selection),
            },
          })
        })
        this.states = nextStates
        this.users = nextUsers
        if (this.localState) this.states.set(this.clientID, this.localState)
        this.emitUpdate()
        this.userListeners.forEach((l) => l(this.getUsers()))
      },
      () => undefined
    )

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
      document.addEventListener('pagehide', this.onPageHide)
      document.addEventListener('pageshow', this.onPageShow)
      this.hidden = document.visibilityState === 'hidden'
    }

    this.heartbeat = setInterval(() => void this.write({ force: true }), HEARTBEAT_MS)
    void this.write({ force: true })
  }

  getUsers(): AwarenessUser[] {
    return Array.from(this.users.values())
  }

  onUserChange(listener: (users: AwarenessUser[]) => void): () => void {
    this.userListeners.add(listener)
    listener(this.getUsers())
    return () => this.userListeners.delete(listener)
  }

  private emitUpdate() {
    const changes = { added: [], updated: [], removed: [] }
    this.listeners.forEach((l) => l(changes))
  }

  getLocalState(): Record<string, unknown> | null {
    return this.localState
  }

  setLocalState(state: Record<string, unknown> | null): void {
    this.localState = state
    if (state) this.states.set(this.clientID, state)
    else this.states.delete(this.clientID)
    this.scheduleWrite()
    this.emitUpdate()
  }

  setLocalStateField(field: string, value: unknown): void {
    this.setLocalState({ ...(this.localState ?? {}), [field]: value })
  }

  getStates(): Map<number, Record<string, unknown>> {
    return new Map(this.states)
  }

  on(_event: 'update', listener: (changes: unknown) => void): void {
    this.listeners.add(listener)
  }

  off(_event: 'update', listener: (changes: unknown) => void): void {
    this.listeners.delete(listener)
  }

  destroy(): void {
    this.destroyed = true
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
      document.removeEventListener('pagehide', this.onPageHide)
      document.removeEventListener('pageshow', this.onPageShow)
    }
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.unsub?.()
    this.listeners.clear()
    this.userListeners.clear()
    this.remove()
  }

  /** Best effort: the delete is queued even while the page is going away. */
  private remove(): void {
    if (!this.fs) return
    void deleteDoc(doc(this.fs, 'notes', this.noteId, 'presence', this.uid))
      .then(() => {
        this.stats.deletes++
      })
      .catch(() => undefined)
  }

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.write(), WRITE_THROTTLE_MS)
  }

  private async write({ force = false } = {}): Promise<void> {
    if (!this.fs || this.destroyed || !this.localState) return
    if (this.hidden && !force) return

    const cursor = (this.localState.cursor ?? {}) as { anchor?: unknown; head?: unknown }
    const payload = `${jsonToBase64(cursor.anchor ?? null)}|${jsonToBase64(cursor.head ?? null)}`
    // Identical caret + recent heartbeat means there is nothing new to say.
    if (!force && payload === this.lastSent && Date.now() - this.lastSentAt < HEARTBEAT_MS) return

    try {
      await setDoc(doc(this.fs, 'notes', this.noteId, 'presence', this.uid), {
        userId: this.uid,
        clientId: this.clientID,
        name: this.user.name.slice(0, 120),
        color: this.user.color,
        cursor: jsonToBase64(cursor.anchor ?? null),
        selection: jsonToBase64(cursor.head ?? null),
        updatedAt: serverTimestamp(),
      })
      this.lastSent = payload
      this.lastSentAt = Date.now()
      this.stats.writes++
    } catch {
      // Presence is best-effort; never break editing because of it.
    }
  }
}
