import { doc, increment, onSnapshot, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Usage accounting, daily buckets.
 *
 * Counters come from the sync provider (blocks, bytes and compaction deletes
 * written/read) and from the notes themselves (storage). They are written at
 * most once every 30 s, and each UTC day gets its own bucket:
 * `usage/{uid}/days/{YYYY-MM-DD}`. A bucket is never reset, so a day boundary
 * cannot mix two days' totals and an old total can never be shown as the
 * current day. The earlier single document (`usage/{uid}`) accumulated forever
 * and relabelled old totals as the current day; the rules keep it writable for
 * one deploy cycle so cached clients do not break.
 *
 * Important: this is measured by the client, so it is good for transparency and
 * for sanity-checking a plan, not for charging money — a metered plan needs a
 * server-side counter (see docs/roadmap.md §4).
 */

export interface UsageTotals {
  day: string
  writes: number
  reads: number
  deletes: number
  bytesWritten: number
  bytesRead: number
  storageBytes: number
  /** Tool calls / commands run by CLI or MCP agents today. */
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

// Public Firestore Standard Edition rates (US regions, Nov 2026): what the
// app pays. The published price is the cost plus the app's margin.
export const RATE_READS_PER_100K = 0.03
export const RATE_WRITES_PER_100K = 0.09
export const RATE_DELETES_PER_100K = 0.01
export const RATE_STORAGE_GIB_MONTH = 0.15
export const RATE_EGRESS_GIB = 0.12
/** Point-in-time recovery and backups are active in production; both scale with GiB. */
export const RATE_PITR_GIB_MONTH = 0.15
export const RATE_BACKUP_GIB_MONTH = 0.03

// Published prices: cost + margin. The margin is the "porcentaje de ganancia"
// the daily fee carries. Storage and PITR/backup are folded into one line.
export const PRICE_READS_PER_100K = 0.3
export const PRICE_WRITES_PER_100K = 0.5
export const PRICE_DELETES_PER_100K = 0.1
export const PRICE_STORAGE_GIB_MONTH = 0.6
export const PRICE_EGRESS_GIB = 0.2

/**
 * Compra mínima: $1. Es el precio de entrada, el que no asusta a una cuenta
 * nueva que quiere probar el modo de saldo.
 */
export const MIN_TOP_UP_USD = 1
/** Techo de una recarga suelta: corta el dedazo, no el uso real. */
export const MAX_TOP_UP_USD = 100
/**
 * Piso de la recarga AUTOMÁTICA. Se dispara sola y repite el fee fijo del MoR
 * (~$0,30-0,40 + %), así que con $1 el procesamiento se come el margen: para
 * que se recargue sin que alguien lo mire, el mínimo es más alto.
 */
export const MIN_AUTO_TOP_UP_USD = 5

/** El saldo prepago vence a los 24 meses (D3). */
export const CREDIT_EXPIRY_MONTHS = 24

const GIB = 1024 ** 3

export function currentDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** First instant of the next UTC day; the daily quota rolls over then. */
export function nextDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

function usageDoc(uid: string, day: string, firestore: Firestore) {
  return doc(firestore, 'usage', uid, 'days', day)
}

export async function recordUsage(
  uid: string,
  delta: UsageDelta,
  firestore: Firestore | null = db
): Promise<void> {
  if (!firestore) return
  const day = currentDay()
  const writes = Math.max(0, Math.round(delta.writes ?? 0))
  const reads = Math.max(0, Math.round(delta.reads ?? 0))
  const deletes = Math.max(0, Math.round(delta.deletes ?? 0))
  const bytesWritten = Math.max(0, Math.round(delta.bytesWritten ?? 0))
  const bytesRead = Math.max(0, Math.round(delta.bytesRead ?? 0))
  const agentOps = Math.max(0, Math.round(delta.agentOps ?? 0))
  if (writes + reads + deletes + bytesWritten + bytesRead + agentOps === 0) return

  await setDoc(
    usageDoc(uid, day, firestore),
    {
      day,
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
  const day = currentDay()
  await setDoc(
    usageDoc(uid, day, firestore),
    {
      day,
      storageBytes: Math.max(0, Math.round(storageBytes)),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

function toTotals(data: Record<string, unknown>, day: string): UsageTotals {
  return {
    day: typeof data.day === 'string' ? data.day : day,
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
 * Watches the current day's bucket. When the UTC day turns over while the
 * dialog is open, the listener moves to the new bucket instead of showing the
 * previous day's totals under the new day's label.
 */
export function subscribeUsage(uid: string, onChange: (usage: UsageTotals | null) => void): () => void {
  if (!db) return () => undefined
  const firestore = db
  let off: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let day = currentDay()

  const schedule = () => {
    const delay = nextDayStart().getTime() - Date.now()
    timer = setTimeout(
      () => {
        if (currentDay() === day) {
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
    day = currentDay()
    off = onSnapshot(
      usageDoc(uid, day, firestore),
      (snap) => {
        const data = snap.data()
        onChange(data ? toTotals(data, day) : null)
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
 * What this day costs the app at list price. Storage, PITR and backup are
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

/**
 * What the account is charged for this day: the published price of the usage
 * over the free daily quota. The difference with `costBreakdown` is the app's
 * margin (the "porcentaje de ganancia").
 */
export function chargeBreakdown(totals: CostInput): CostBreakdown {
  const reads = (count(totals.reads) / 100_000) * PRICE_READS_PER_100K
  const writes = (count(totals.writes) / 100_000) * PRICE_WRITES_PER_100K
  const deletes = (count(totals.deletes) / 100_000) * PRICE_DELETES_PER_100K
  const gib = count(totals.storageBytes) / GIB
  const storage = gib * PRICE_STORAGE_GIB_MONTH
  const egress = (count(totals.bytesRead) / GIB) * PRICE_EGRESS_GIB
  const total = reads + writes + deletes + storage + egress
  return { reads, writes, deletes, storage, pitr: 0, backup: 0, egress, total }
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
