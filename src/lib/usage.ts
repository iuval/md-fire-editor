import { doc, increment, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Usage accounting.
 *
 * Counters come from the sync provider (blocks and bytes written/read) and from
 * the notes themselves (storage). They are written at most once every 30 s.
 *
 * Important: this is measured by the client, so it is good for transparency and
 * for sanity-checking a plan, not for charging money — a metered plan needs a
 * server-side counter (see docs/roadmap.md §4).
 */

export interface UsageTotals {
  month: string
  writes: number
  reads: number
  bytesWritten: number
  bytesRead: number
  storageBytes: number
}

export interface UsageDelta {
  writes?: number
  reads?: number
  bytesWritten?: number
  bytesRead?: number
  storageBytes?: number
}

// Public Firestore rates (multi-region, Nov 2026).
export const RATE_READS_PER_100K = 0.03
export const RATE_WRITES_PER_100K = 0.09

export const MIN_TOP_UP_USD = 2

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Download cost only; storage for text notes is far below a cent. */
export function estimateCost(totals: Pick<UsageTotals, 'reads' | 'writes'>): number {
  return (totals.reads / 100_000) * RATE_READS_PER_100K + (totals.writes / 100_000) * RATE_WRITES_PER_100K
}

export async function recordUsage(
  uid: string,
  delta: UsageDelta,
  firestore: Firestore | null = db
): Promise<void> {
  if (!firestore) return
  const writes = Math.max(0, Math.round(delta.writes ?? 0))
  const reads = Math.max(0, Math.round(delta.reads ?? 0))
  const bytesWritten = Math.max(0, Math.round(delta.bytesWritten ?? 0))
  const bytesRead = Math.max(0, Math.round(delta.bytesRead ?? 0))
  if (writes + reads + bytesWritten + bytesRead === 0) return

  await setDoc(
    doc(firestore, 'usage', uid),
    {
      month: currentMonth(),
      writes: increment(writes),
      reads: increment(reads),
      bytesWritten: increment(bytesWritten),
      bytesRead: increment(bytesRead),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

export async function setStorageUsage(
  uid: string,
  storageBytes: number,
  firestore: Firestore | null = db
): Promise<void> {
  if (!firestore) return
  await setDoc(
    doc(firestore, 'usage', uid),
    { month: currentMonth(), storageBytes: Math.max(0, Math.round(storageBytes)), updatedAt: serverTimestamp() },
    { merge: true }
  )
}

export function subscribeUsage(uid: string, onChange: (usage: UsageTotals | null) => void): () => void {
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'usage', uid),
    (snap) => {
      const data = snap.data()
      if (!data) {
        onChange(null)
        return
      }
      onChange({
        month: String(data.month ?? currentMonth()),
        writes: Number(data.writes ?? 0),
        reads: Number(data.reads ?? 0),
        bytesWritten: Number(data.bytesWritten ?? 0),
        bytesRead: Number(data.bytesRead ?? 0),
        storageBytes: Number(data.storageBytes ?? 0),
      })
    },
    () => onChange(null)
  )
}

export interface Credits {
  balanceUsd: number
  thresholdUsd: number
  topUpUsd: number
  autoTopUp: boolean
}

/** Read-only for the user: balances are written by an admin only (rules). */
export function subscribeCredits(uid: string, onChange: (credits: Credits | null) => void): () => void {
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'credits', uid),
    (snap) => {
      const data = snap.data()
      if (!data) {
        onChange(null)
        return
      }
      onChange({
        balanceUsd: Number(data.balanceUsd ?? 0),
        thresholdUsd: Number(data.thresholdUsd ?? 0),
        topUpUsd: Number(data.topUpUsd ?? 0),
        autoTopUp: Boolean(data.autoTopUp),
      })
    },
    () => onChange(null)
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`
}
