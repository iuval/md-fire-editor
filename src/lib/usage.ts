import { doc, increment, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Usage accounting.
 *
 * Counters come from the sync provider (blocks, bytes and compaction deletes
 * written/read) and from the notes themselves (storage). They are written at
 * most once every 30 s, and each month gets its own bucket:
 * `usage/{uid}/months/{YYYY-MM}`. A bucket is never reset, so a month boundary
 * cannot mix two months' totals and an old total can never be shown as the
 * current month. The earlier single document (`usage/{uid}`) accumulated
 * forever and relabelled old totals as the current month; the rules keep it
 * writable for one deploy cycle so cached clients do not break.
 *
 * Important: this is measured by the client, so it is good for transparency and
 * for sanity-checking a plan, not for charging money — a metered plan needs a
 * server-side counter (see docs/roadmap.md §4).
 */

export interface UsageTotals {
  month: string
  writes: number
  reads: number
  deletes: number
  bytesWritten: number
  bytesRead: number
  storageBytes: number
  /** Tool calls / commands run by CLI or MCP agents this month. */
  agentOps: number
}

export interface UsageDelta {
  writes?: number
  reads?: number
  deletes?: number
  bytesWritten?: number
  bytesRead?: number
  storageBytes?: number
  agentOps?: number
}

// Public Firestore Standard Edition rates (US regions, Nov 2026).
export const RATE_READS_PER_100K = 0.03
export const RATE_WRITES_PER_100K = 0.09
export const RATE_DELETES_PER_100K = 0.01
export const RATE_STORAGE_GIB_MONTH = 0.15
export const RATE_EGRESS_GIB = 0.12
/** Point-in-time recovery and backups are active in production; both scale with GiB. */
export const RATE_PITR_GIB_MONTH = 0.15
export const RATE_BACKUP_GIB_MONTH = 0.03

export const MIN_TOP_UP_USD = 5

/** Fee fijo mensual por cuenta con actividad (D3/D5). Las cuentas admin no pagan. */
export const MONTHLY_FEE_USD = 0.5

/** El saldo prepago vence a los 24 meses (D3). */
export const CREDIT_EXPIRY_MONTHS = 24

const GIB = 1024 ** 3

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** First instant of the next UTC month; the subscription rolls over then. */
export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

function usageDoc(uid: string, month: string, firestore: Firestore) {
  return doc(firestore, 'usage', uid, 'months', month)
}

export async function recordUsage(
  uid: string,
  delta: UsageDelta,
  firestore: Firestore | null = db
): Promise<void> {
  if (!firestore) return
  const month = currentMonth()
  const writes = Math.max(0, Math.round(delta.writes ?? 0))
  const reads = Math.max(0, Math.round(delta.reads ?? 0))
  const deletes = Math.max(0, Math.round(delta.deletes ?? 0))
  const bytesWritten = Math.max(0, Math.round(delta.bytesWritten ?? 0))
  const bytesRead = Math.max(0, Math.round(delta.bytesRead ?? 0))
  const agentOps = Math.max(0, Math.round(delta.agentOps ?? 0))
  if (writes + reads + deletes + bytesWritten + bytesRead + agentOps === 0) return

  await setDoc(
    usageDoc(uid, month, firestore),
    {
      month,
      writes: increment(writes),
      reads: increment(reads),
      deletes: increment(deletes),
      bytesWritten: increment(bytesWritten),
      bytesRead: increment(bytesRead),
      ...(agentOps > 0 ? { agentOps: increment(agentOps) } : {}),
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
  const month = currentMonth()
  await setDoc(
    usageDoc(uid, month, firestore),
    {
      month,
      storageBytes: Math.max(0, Math.round(storageBytes)),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

function toTotals(data: Record<string, unknown>, month: string): UsageTotals {
  return {
    month: typeof data.month === 'string' ? data.month : month,
    writes: Number(data.writes ?? 0),
    reads: Number(data.reads ?? 0),
    deletes: Number(data.deletes ?? 0),
    bytesWritten: Number(data.bytesWritten ?? 0),
    bytesRead: Number(data.bytesRead ?? 0),
    storageBytes: Number(data.storageBytes ?? 0),
    agentOps: Number(data.agentOps ?? 0),
  }
}

/**
 * Watches the current month's bucket. When the UTC month turns over while the
 * dialog is open, the listener moves to the new bucket instead of showing the
 * previous month's totals under the new month's label.
 */
export function subscribeUsage(uid: string, onChange: (usage: UsageTotals | null) => void): () => void {
  if (!db) return () => undefined
  const firestore = db
  let off: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let month = currentMonth()

  // setTimeout overflows above ~24.8 days, so a month-long wait is capped and
  // re-checked. Reopening only when the month actually changed avoids a loop.
  const schedule = () => {
    const delay = nextMonthStart().getTime() - Date.now()
    timer = setTimeout(
      () => {
        if (currentMonth() === month) {
          schedule()
          return
        }
        off?.()
        off = null
        open()
      },
      Math.min(Math.max(1000, delay), 24 * 60 * 60 * 1000)
    )
  }

  const open = () => {
    month = currentMonth()
    off = onSnapshot(
      usageDoc(uid, month, firestore),
      (snap) => {
        const data = snap.data()
        onChange(data ? toTotals(data, month) : null)
      },
      () => onChange(null)
    )
    schedule()
  }

  open()
  return () => {
    if (timer) clearTimeout(timer)
    off?.()
  }
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

export type CostInput = Partial<
  Pick<UsageTotals, 'reads' | 'writes' | 'deletes' | 'storageBytes' | 'bytesRead'>
>

export interface CostBreakdown {
  reads: number
  writes: number
  deletes: number
  storage: number
  pitr: number
  backup: number
  egress: number
  total: number
}

const count = (value: number | undefined) => Math.max(0, Number(value) || 0)

/**
 * What this month would cost at list price. Storage, PITR and backup are
 * prorated by the stored bytes; egress uses the bytes read as a lower bound.
 * The project's free daily quota is not subtracted: this is the gross cost of
 * one account, which is what the dialog shows.
 */
export function costBreakdown(totals: CostInput): CostBreakdown {
  const reads = (count(totals.reads) / 100_000) * RATE_READS_PER_100K
  const writes = (count(totals.writes) / 100_000) * RATE_WRITES_PER_100K
  const deletes = (count(totals.deletes) / 100_000) * RATE_DELETES_PER_100K
  const gib = count(totals.storageBytes) / GIB
  const storage = gib * RATE_STORAGE_GIB_MONTH
  const pitr = gib * RATE_PITR_GIB_MONTH
  const backup = gib * RATE_BACKUP_GIB_MONTH
  const egress = (count(totals.bytesRead) / GIB) * RATE_EGRESS_GIB
  const total = reads + writes + deletes + storage + pitr + backup + egress
  return { reads, writes, deletes, storage, pitr, backup, egress, total }
}

export function estimateCost(totals: CostInput): number {
  return costBreakdown(totals).total
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 0.1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}
