import { t } from '../../i18n/index.ts'
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
import { postBlock, postCompact, proxyEnabled } from '../proxy'
import { base64ToBytes, bytesToBase64, sha256Hex } from './encoding'
import { openLocalChannel, type LocalChannel, type LocalChannelFactory } from './localChannel'
import { classifyTransportError } from './transportError'
import { isLocalMode } from '../localStore'

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
  /** Documents removed by compaction; each one is a Firestore delete. */
  blocksDeleted: number
  /** Manifest documents written by compaction; each one is a Firestore write. */
  manifestWrites: number
  rejectedBlocks: number
  compactions: number
  /** Presence writes/deletes, merged in by NoteSession (the provider does not own presence). */
  presenceWrites?: number
  presenceDeletes?: number
}

export interface ProviderStatus {
  connected: boolean
  /**
   * The document lives in this browser only: a visitor's workspace. Nothing is
   * missing and nothing is broken — the sidebar says "Local" instead of claiming
   * a sync error for a store that has no server to sync with.
   */
  local?: boolean
  /**
   * The backend is unreachable. Optional because the listener keeps serving
   * cached snapshots when the socket drops, so `connected` alone cannot tell
   * "nothing to read" from "nothing to reach".
   */
  offline?: boolean
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
    blocksDeleted: 0,
    manifestWrites: 0,
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
  /**
   * Ids of the blocks already applied, in application order (a `Set` keeps
   * insertion order, so one structure answers both "have I seen this?" and "what
   * does the snapshot fold in?"). It used to be a Set plus a parallel array,
   * holding every id twice.
   */
  private appliedIds = new Set<string>()
  private logBytes = 0
  private maxJid = 0
  private nextJid = 1
  private lastCompactAt = Date.now()
  private compacting = false
  private hydrated = false
  private destroyed = false
  private channel: LocalChannel | null = null
  private listeners = new Set<(status: ProviderStatus) => void>()
  private status: ProviderStatus = {
    connected: false,
    offline: false,
    pendingWrites: 0,
    updateCount: 0,
    error: null,
  }

  /** Test seam: the same-browser lane, defaulting to `BroadcastChannel`. */
  private readonly channelFactory?: LocalChannelFactory

  constructor(
    noteId: string,
    doc: Y.Doc = new Y.Doc(),
    firestore: Firestore | null = defaultDb,
    channelFactory?: LocalChannelFactory
  ) {
    this.noteId = noteId
    this.doc = doc
    this.fs = firestore
    this.channelFactory = channelFactory
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
    if (this.destroyed) return

    this.doc.on('update', this.handleLocalUpdate)

    // The fast lane opens before the network check: two tabs of one account
    // keep working together even when Firebase is not configured.
    this.channel = openLocalChannel(this.noteId, this.doc.clientID, this.channelFactory)
    this.channel?.onMessage((update) => {
      try {
        Y.applyUpdate(this.doc, base64ToBytes(update.data), REMOTE_ORIGIN)
      } catch {
        // A malformed message from another tab cannot break this document.
      }
    })

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
      // The browser's own flag is the only honest one available here: a
      // listener keeps answering from the local cache while the socket is
      // down, and `metadata.fromCache` also covers the shared multi-tab cache,
      // where the data is perfectly fresh. That would have produced a false
      // "Sin conexión" in a healthy session.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.setStatus({ offline: true })
      }
    }

    if (!this.fs) {
      // A visitor's document is persisted in this browser: there is no server to
      // reach, so this is not an error. A signed-in session without Firebase is.
      if (isLocalMode()) {
        this.setStatus({ connected: true, offline: false, local: true, error: null })
        return
      }
      this.setStatus({ connected: false, offline: true, error: t('error.firebaseNotConfigured') })
      return
    }

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
        (err) => this.setTransportError(err)
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
            offline: false,
            updateCount: this.appliedIds.size,
            error: this.status.error,
          })
          this.hydrated = true
          void this.maybeCompact()
        },
        (err) => this.setTransportError(err)
      )
    )
  }

  private handleOnline = () => this.setStatus({ offline: false })

  private handleOffline = () => this.setStatus({ offline: true, connected: false })

  /**
   * A dropped socket is not a broken note: it is queued work, and the words
   * must say so instead of showing a red dot with a raw SDK message.
   */
  private setTransportError(err: unknown) {
    const failure = classifyTransportError(err)
    this.setStatus({
      connected: failure.offline ? false : this.status.connected,
      offline: failure.offline || Boolean(this.status.offline),
      error: failure.error,
    })
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.destroyed) return
    // Same-browser lane first: it is a postMessage, not a write, so it costs
    // nothing and does not need the flush window. REMOTE_ORIGIN on the other
    // side stops the receiver from echoing it back or writing it twice.
    this.channel?.post({
      noteId: this.noteId,
      clientId: this.doc.clientID,
      data: bytesToBase64(update),
    })
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
        error: t('error.updateTooLarge', { kb: Math.round(merged.byteLength / 1024) }),
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
      if (proxyEnabled) {
        // El proxy es el único escritor: resuelve ACL, cuota y saldo, y debita
        // en la misma transacción (docs/prepaid-usage-model.md §3.6).
        const receipt = await postBlock(this.noteId, {
          v: BLOCK_VERSION,
          jid,
          hash,
          bytes: merged.byteLength,
          data,
          clientId: this.doc.clientID,
        })
        // El bloque llega por el listener con el id del opId: registrarlo ya
        // evita aplicarlo dos veces y deja que la compactación lo pode.
        this.appliedIds.add(receipt.id)
      } else {
        const ref = await addDoc(collection(this.fs, 'notes', this.noteId, 'updates'), {
          v: BLOCK_VERSION,
          jid,
          hash,
          bytes: merged.byteLength,
          data,
          clientId: this.doc.clientID,
          createdAt: serverTimestamp(),
        })
        // Our own block arrives through the listener; record it so compaction can
        // prune it and the document is not applied twice.
        this.appliedIds.add(ref.id)
      }
      this.stats.blocksWritten++
      this.stats.bytesWritten += merged.byteLength
      this.logBytes += data.length
      this.setStatus({ error: null })
    } catch (err) {
      this.nextJid = jid
      this.queued.unshift(merged)
      this.queuedBytes += merged.byteLength
      this.setTransportError(err)
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
      this.setStatus({ error: t('error.corruptBlockFromPeer') })
      return
    }

    if (block.hash) {
      const expected = await sha256Hex(bytes)
      if (expected !== block.hash) {
        // Tampered or truncated block: refuse it, keep the rest flowing.
        this.stats.rejectedBlocks++
        this.setStatus({ error: t('error.blockHashMismatch') })
        return
      }
    }

    // Already applied by another path (own write, manifest snapshot).
    if (this.appliedIds.has(block.id)) return
    Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN)
    this.appliedIds.add(block.id)
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

    const tooManyBlocks = this.appliedIds.size >= COMPACT_MIN_BLOCKS
    const tooBig = this.logBytes >= COMPACT_MIN_BYTES
    const idleLongEnough = Date.now() - this.lastCompactAt >= COMPACT_IDLE_MS
    if (!tooManyBlocks && !tooBig && !(idleLongEnough && this.appliedIds.size > 0)) return

    this.compacting = true
    const prune = [...this.appliedIds]
    const snapshot = Y.encodeStateAsUpdate(this.doc)
    const manifest = {
      epoch: BLOCK_VERSION,
      snapshot: bytesToBase64(snapshot),
      stateVector: bytesToBase64(Y.encodeStateVector(this.doc)),
      jid: this.maxJid,
      bytes: snapshot.byteLength,
      clientId: this.doc.clientID,
    }
    try {
      if (proxyEnabled) {
        // El proxy escribe el manifest y borra los bloques en una transacción,
        // cobrando los borrados (E5). Mismo límite de 400 por mensaje.
        for (let i = 0; i < prune.length; i += 400) {
          const chunk = prune.slice(i, i + 400)
          await postCompact(this.noteId, { blockIds: chunk, manifest })
          this.stats.manifestWrites++
          this.stats.blocksDeleted += chunk.length
        }
      } else {
        await setDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'manifest'), {
          ...manifest,
          updatedAt: serverTimestamp(),
        })
        this.stats.manifestWrites++

        // Prune exactly the ids folded into the snapshot: a block written while
        // we were compacting is not in that list, so it can never be dropped.
        for (let i = 0; i < prune.length; i += 400) {
          const batch = writeBatch(this.fs)
          const chunk = prune.slice(i, i + 400)
          chunk.forEach((id) => {
            batch.delete(doc(this.fs!, 'notes', this.noteId, 'updates', id))
          })
          await batch.commit()
          this.stats.blocksDeleted += chunk.length
        }
      }

      // Drop the v1 snapshot once its content is folded into the manifest.
      await deleteDoc(doc(this.fs, 'notes', this.noteId, 'collab', 'state')).catch(() => undefined)

      prune.forEach((id) => this.appliedIds.delete(id))
      this.logBytes = 0
      this.lastCompactAt = Date.now()
      this.stats.compactions++
      this.setStatus({ updateCount: this.appliedIds.size, error: null })
    } catch (err) {
      this.setTransportError(err)
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
    this.channel?.close()
    this.channel = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('offline', this.handleOffline)
    }
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
