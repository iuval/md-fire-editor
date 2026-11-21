import * as Y from 'yjs'
import type { Firestore } from 'firebase/firestore'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db as defaultDb } from '../../firebase'
import { base64ToBytes, bytesToBase64 } from './encoding'

const REMOTE_ORIGIN = Symbol('firestore-remote')
const FLUSH_DEBOUNCE_MS = 400
const COMPACT_AFTER_UPDATES = 120

export interface ProviderStatus {
  connected: boolean
  pendingWrites: number
  updateCount: number
  error: string | null
}

/**
 * Minimal Yjs transport over Firestore.
 *
 * - Local document updates are batched (250 ms) and appended to
 *   `notes/{noteId}/updates` as base64-encoded Yjs updates.
 * - Remote updates arrive through `onSnapshot` and are applied to the shared
 *   Y.Doc. Re-applying an update is a no-op in Yjs, so at-least-once delivery
 *   is safe.
 * - When the update log grows past COMPACT_AFTER_UPDATES a client writes the
 *   full state to `notes/{noteId}/collab/state` and prunes the folded updates.
 */
export class FirestoreYjsProvider {
  readonly doc: Y.Doc
  private readonly noteId: string
  private unsubs: Array<() => void> = []
  private queued: Uint8Array[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private appliedUpdateDocs = new Set<string>()
  private compacting = false
  private destroyed = false
  private listeners = new Set<(status: ProviderStatus) => void>()
  private status: ProviderStatus = { connected: false, pendingWrites: 0, updateCount: 0, error: null }
  private readonly fs: Firestore | null

  constructor(noteId: string, doc: Y.Doc = new Y.Doc(), firestore: Firestore | null = defaultDb) {
    this.noteId = noteId
    this.doc = doc
    this.fs = firestore
  }

  onStatus(listener: (status: ProviderStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private setStatus(patch: Partial<ProviderStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l(this.status))
  }

  connect(): void {
    if (!this.fs || this.destroyed) {
      this.setStatus({ error: 'Firebase not configured' })
      return
    }

    this.doc.on('update', this.handleLocalUpdate)

    const stateRef = doc(this.fs, 'notes', this.noteId, 'collab', 'state')
    this.unsubs.push(
      onSnapshot(
        stateRef,
        (snap) => {
          const data = snap.data()
          if (data?.state) {
            this.applyRemote(base64ToBytes(data.state as string))
          }
        },
        (err) => this.setStatus({ error: err.message })
      )
    )

    const updatesQuery = query(
      collection(this.fs, 'notes', this.noteId, 'updates'),
      orderBy('createdAt', 'asc')
    )
    this.unsubs.push(
      onSnapshot(
        updatesQuery,
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type !== 'added') return
            if (this.appliedUpdateDocs.has(change.doc.id)) return
            const data = change.doc.data()
            if (typeof data?.data === 'string') {
              this.appliedUpdateDocs.add(change.doc.id)
              this.applyRemote(base64ToBytes(data.data))
            }
          })
          this.setStatus({
            connected: true,
            updateCount: this.appliedUpdateDocs.size,
            error: null,
          })
          void this.maybeCompact()
        },
        (err) => this.setStatus({ connected: false, error: err.message })
      )
    )
  }

  private applyRemote(update: Uint8Array) {
    try {
      Y.applyUpdate(this.doc, update, REMOTE_ORIGIN)
    } catch {
      // A denied write still shows up in the local Firestore cache before the
      // server rejects it, and its payload may not be a valid Yjs update.
      // Ignoring it keeps a rejected write from breaking the session.
    }
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.destroyed) return
    this.queued.push(update)
    this.setStatus({ pendingWrites: this.queued.length })
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DEBOUNCE_MS)
  }

  private async flush(): Promise<void> {
    if (!this.fs || this.queued.length === 0) return
    const merged = this.queued.length === 1 ? this.queued[0] : Y.mergeUpdates(this.queued)
    this.queued = []
    this.setStatus({ pendingWrites: 0 })
    try {
      await addDoc(collection(this.fs, 'notes', this.noteId, 'updates'), {
        data: bytesToBase64(merged),
        clientId: this.doc.clientID,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      this.setStatus({ error: (err as Error).message })
    }
  }

  private async maybeCompact(): Promise<void> {
    if (!this.fs || this.compacting) return
    if (this.appliedUpdateDocs.size < COMPACT_AFTER_UPDATES) return

    this.compacting = true
    const prune = Array.from(this.appliedUpdateDocs)
    try {
      await setDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'state'), {
        state: bytesToBase64(Y.encodeStateAsUpdate(this.doc)),
        clientId: this.doc.clientID,
        updatedAt: serverTimestamp(),
      })
      await Promise.all(
        prune.map((id) =>
          deleteDoc(doc(this.fs!, 'notes', this.noteId, 'updates', id)).catch(() => undefined)
        )
      )
      prune.forEach((id) => this.appliedUpdateDocs.delete(id))
      this.setStatus({ updateCount: this.appliedUpdateDocs.size })
    } catch (err) {
      this.setStatus({ error: (err as Error).message })
    } finally {
      this.compacting = false
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
      void this.flush()
    }
    this.doc.off('update', this.handleLocalUpdate)
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.listeners.clear()
  }
}
