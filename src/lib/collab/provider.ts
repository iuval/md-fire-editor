import * as Y from 'yjs'
import type { Firestore } from 'firebase/firestore'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db as defaultDb } from '../../firebase'
import { base64ToBytes, bytesToBase64, sha256Hex } from './encoding'

const REMOTE_ORIGIN = Symbol('firestore-remote')

// Transport tuning. See docs/sync-algorithms.md §9 for the reasoning.
const BLOCK_VERSION = 1
const FLUSH_MS = 350 // trailing throttle: bounded latency while typing
const MAX_INFLIGHT = 2 // backpressure, like Google Docs' wait-for-ack
const MAX_BLOCK_CHARS = 600_000 // base64 chars; keeps the doc far below 1 MiB
const COMPACT_MIN_BLOCKS = 40
const COMPACT_MIN_BYTES = 160_000
const COMPACT_IDLE_MS = 5 * 60_000

export interface SyncStats {
  blocksWritten: number
  bytesWritten: number
  blocksApplied: number
  bytesApplied: number
  rejectedBlocks: number
  compactions: number
}

export interface ProviderStatus {
  connected: boolean
  pendingWrites: number
  updateCount: number
  error: string | null
}

interface BlockDoc {
  id: string
  jid: number
  hash: string
  data: string
}

/**
 * Yjs transport over Firestore, block based.
 *
 * Layout
 *   notes/{id}/updates/{blockId}  one binary Yjs block: { v, jid, hash, bytes, data, clientId, createdAt }
 *   notes/{id}/collab/manifest    { snapshot, stateVector, jid, bytes, updatedAt, epoch }
 *
 * Properties taken from the systems in docs/sync-algorithms.md:
 *   - content addressing: every block carries a SHA-256 prefix and is verified
 *     before it is applied (Dropbox blocklist / Git objects)
 *   - manifest separating metadata from content, so joining is one manifest read
 *     plus a short tail instead of replaying the whole log (Dropbox SFJ + JID)
 *   - bounded blocks, so a huge paste never approaches the 1 MiB document limit
 *   - backpressure with at most MAX_INFLIGHT writes in flight (Docs' acks)
 *   - trailing throttle instead of a pure debounce, so peers see edits within
 *     FLUSH_MS instead of waiting for the writer to stop (the measured problem)
 */
export class FirestoreYjsProvider {
  readonly doc: Y.Doc
  readonly stats: SyncStats = {
    blocksWritten: 0,
    bytesWritten: 0,
    blocksApplied: 0,
    bytesApplied: 0,
    rejectedBlocks: 0,
    compactions: 0,
  }

  private readonly noteId: string
  private readonly fs: Firestore | null
  private unsubs: Unsubscribe[] = []
  private queued: Uint8Array[] = []
  private queuedBytes = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private inflight = 0
  private appliedIds = new Set<string>()
  private appliedOrder: string[] = []
  private logBytes = 0
  private maxJid = 0
  private nextJid = 1
  private lastCompactAt = Date.now()
  private compacting = false
  private hydrated = false
  private destroyed = false
  private listeners = new Set<(status: ProviderStatus) => void>()
  private status: ProviderStatus = { connected: false, pendingWrites: 0, updateCount: 0, error: null }

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
      this.setStatus({ error: 'Firebase no está configurado' })
      return
    }

    this.doc.on('update', this.handleLocalUpdate)

    const manifestRef = doc(this.fs, 'notes', this.noteId, 'collab', 'manifest')
    this.unsubs.push(
      onSnapshot(
        manifestRef,
        (snap) => {
          const data = snap.data()
          if (data?.jid && typeof data.jid === 'number') {
            this.maxJid = Math.max(this.maxJid, data.jid)
            this.nextJid = Math.max(this.nextJid, data.jid + 1)
          }
          if (typeof data?.snapshot === 'string' && data.snapshot) {
            // The snapshot is additive: applying it over local edits converges.
            this.applySnapshot(base64ToBytes(data.snapshot))
          }
        },
        (err) => this.setStatus({ error: err.message })
      )
    )

    // No orderBy: Yjs updates are order independent, and documents written by
    // the v1 provider have no `jid` field — they must still be replayed.
    const blocksQuery = query(collection(this.fs, 'notes', this.noteId, 'updates'))
    // v1 notes kept their compacted state in `collab/state`: apply it once.
    void this.applyLegacyState()

    this.unsubs.push(
      onSnapshot(
        blocksQuery,
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type !== 'added') return
            const data = change.doc.data()
            if (typeof data?.data !== 'string') return
            const block: BlockDoc = {
              id: change.doc.id,
              jid: Number(data.jid) || 0,
              hash: String(data.hash ?? ''),
              data: data.data,
            }
            this.maxJid = Math.max(this.maxJid, block.jid)
            this.nextJid = Math.max(this.nextJid, block.jid + 1)
            void this.applyBlock(block)
          })
          this.setStatus({
            connected: true,
            updateCount: this.appliedIds.size,
            error: this.status.error,
          })
          this.hydrated = true
          void this.maybeCompact()
        },
        (err) => this.setStatus({ connected: false, error: err.message })
      )
    )
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.destroyed) return
    this.queued.push(update)
    this.queuedBytes += update.byteLength
    this.setStatus({ pendingWrites: this.queued.length })
    // Trailing throttle: the first edit arms the timer, later edits join it.
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        void this.flush()
      }, FLUSH_MS)
    }
  }

  private async flush(): Promise<void> {
    if (!this.fs || this.queued.length === 0) return
    if (this.inflight >= MAX_INFLIGHT) {
      // Backpressure: retry shortly instead of piling writes up.
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null
          void this.flush()
        }, FLUSH_MS)
      }
      return
    }

    const merged = this.queued.length === 1 ? this.queued[0] : Y.mergeUpdates(this.queued)
    const data = bytesToBase64(merged)

    if (data.length > MAX_BLOCK_CHARS) {
      // Cannot split a Yjs update; surface it instead of silently losing text.
      this.queued = []
      this.queuedBytes = 0
      this.setStatus({
        pendingWrites: 0,
        error: `el cambio es demasiado grande (${Math.round(merged.byteLength / 1024)} KB)`,
      })
      return
    }

    this.queued = []
    this.queuedBytes = 0
    this.setStatus({ pendingWrites: 0 })

    const hash = await sha256Hex(merged)
    const jid = this.nextJid++
    this.inflight++

    try {
      const ref = await addDoc(collection(this.fs, 'notes', this.noteId, 'updates'), {
        v: BLOCK_VERSION,
        jid,
        hash,
        bytes: merged.byteLength,
        data,
        clientId: this.doc.clientID,
        createdAt: serverTimestamp(),
      })
      this.stats.blocksWritten++
      this.stats.bytesWritten += merged.byteLength
      // Our own block arrives through the listener; record it so compaction can
      // prune it and the document is not applied twice.
      this.appliedIds.add(ref.id)
      this.appliedOrder.push(ref.id)
      this.logBytes += data.length
      this.setStatus({ error: null })
    } catch (err) {
      this.nextJid = jid
      this.queued.unshift(merged)
      this.queuedBytes += merged.byteLength
      this.setStatus({ error: (err as Error).message })
    } finally {
      this.inflight--
    }

    if (this.queued.length > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        void this.flush()
      }, FLUSH_MS)
    }
    void this.maybeCompact()
  }

  private async applyBlock(block: BlockDoc): Promise<void> {
    if (this.appliedIds.has(block.id)) return
    let bytes: Uint8Array
    try {
      bytes = base64ToBytes(block.data)
    } catch {
      this.stats.rejectedBlocks++
      this.setStatus({ error: 'bloque corrupto (base64 inválido)' })
      return
    }

    if (block.hash) {
      const expected = await sha256Hex(bytes)
      if (expected !== block.hash) {
        // Tampered or truncated block: refuse it, keep the rest flowing.
        this.stats.rejectedBlocks++
        this.setStatus({ error: 'bloque rechazado: el hash no coincide' })
        return
      }
    }

    // Already applied by another path (own write, manifest snapshot).
    if (this.appliedIds.has(block.id)) return
    Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN)
    this.appliedIds.add(block.id)
    this.appliedOrder.push(block.id)
    this.logBytes += block.data.length
    this.stats.blocksApplied++
    this.stats.bytesApplied += bytes.byteLength
    this.setStatus({ updateCount: this.appliedIds.size })
  }

  private applySnapshot(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, REMOTE_ORIGIN)
    this.stats.bytesApplied += update.byteLength
  }

  /** v1 notes kept their compacted state in `collab/state`. */
  private async applyLegacyState(): Promise<void> {
    if (!this.fs) return
    try {
      const snap = await getDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'state'))
      const state = snap.data()?.state
      if (typeof state === 'string' && state) {
        this.applySnapshot(base64ToBytes(state))
      }
    } catch {
      // A note that never used the v1 schema simply has no such document.
    }
  }

  private async maybeCompact(): Promise<void> {
    if (!this.fs || this.compacting || this.destroyed) return
    if (!this.hydrated) return

    const tooManyBlocks = this.appliedOrder.length >= COMPACT_MIN_BLOCKS
    const tooBig = this.logBytes >= COMPACT_MIN_BYTES
    const idleLongEnough = Date.now() - this.lastCompactAt >= COMPACT_IDLE_MS
    if (!tooManyBlocks && !tooBig && !(idleLongEnough && this.appliedOrder.length > 0)) return

    this.compacting = true
    const prune = [...this.appliedOrder]
    const snapshot = Y.encodeStateAsUpdate(this.doc)
    try {
      await setDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'manifest'), {
        epoch: BLOCK_VERSION,
        snapshot: bytesToBase64(snapshot),
        stateVector: bytesToBase64(Y.encodeStateVector(this.doc)),
        jid: this.maxJid,
        bytes: snapshot.byteLength,
        clientId: this.doc.clientID,
        updatedAt: serverTimestamp(),
      })

      // Prune exactly the ids folded into the snapshot: a block written while
      // we were compacting is not in that list, so it can never be dropped.
      for (let i = 0; i < prune.length; i += 400) {
        const batch = writeBatch(this.fs)
        prune.slice(i, i + 400).forEach((id) => {
          batch.delete(doc(this.fs!, 'notes', this.noteId, 'updates', id))
        })
        await batch.commit()
      }

      // Drop the v1 snapshot once its content is folded into the manifest.
      await deleteDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'state')).catch(() => undefined)

      prune.forEach((id) => this.appliedIds.delete(id))
      this.appliedOrder = []
      this.logBytes = 0
      this.lastCompactAt = Date.now()
      this.stats.compactions++
      this.setStatus({ updateCount: this.appliedIds.size, error: null })
    } catch (err) {
      this.setStatus({ error: (err as Error).message })
    } finally {
      this.compacting = false
    }
  }

  /** Test/debug helper: force a compaction check. */
  async compactNow(): Promise<void> {
    this.lastCompactAt = 0
    await this.maybeCompact()
  }

  destroy(): void {
    this.destroyed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.queued.length > 0) void this.flush()
    this.doc.off('update', this.handleLocalUpdate)
    this.unsubs.forEach((unsub) => unsub())
    this.unsubs = []
    this.listeners.clear()
  }
}
