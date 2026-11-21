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

const HEARTBEAT_MS = 15_000
const WRITE_THROTTLE_MS = 200
const STALE_AFTER_MS = 45_000

/**
 * `y-protocols` Awareness-compatible object whose transport is a Firestore
 * `presence` sub-collection instead of a websocket. Only the subset used by
 * Tiptap's CollaborationCaret is implemented:
 *   clientID, getLocalState, setLocalStateField, getStates, on/off('update').
 */
export class FirestoreAwareness {
  readonly clientID: number
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

    this.heartbeat = setInterval(() => void this.write(), HEARTBEAT_MS)
    void this.write()
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
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.unsub?.()
    this.listeners.clear()
    this.userListeners.clear()
    if (this.fs) {
      void deleteDoc(doc(this.fs, 'notes', this.noteId, 'presence', this.uid)).catch(() => undefined)
    }
  }

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.write(), WRITE_THROTTLE_MS)
  }

  private async write(): Promise<void> {
    if (!this.fs || this.destroyed || !this.localState) return
    const cursor = (this.localState.cursor ?? {}) as { anchor?: unknown; head?: unknown }
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
    } catch {
      // Presence is best-effort; never break editing because of it.
    }
  }
}
