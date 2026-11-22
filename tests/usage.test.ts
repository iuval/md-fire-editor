import { describe, expect, it } from 'vitest'
import {
  chargeBreakdown,
  costBreakdown,
  currentDay,
  estimateCost,
  formatBytes,
  formatUsd,
  MIN_TOP_UP_USD,
  nextDayStart,
  RATE_DELETES_PER_100K,
  RATE_READS_PER_100K,
  RATE_WRITES_PER_100K,
} from '../src/lib/usage'

const GIB = 1024 ** 3

describe('usage accounting', () => {
  it('formats the day as YYYY-MM-DD in UTC', () => {
    expect(currentDay(new Date('2026-11-22T03:00:00Z'))).toBe('2026-11-22')
    expect(currentDay(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
  })

  it('rolls the bucket over at the first UTC instant of the next day', () => {
    expect(nextDayStart(new Date('2026-11-22T15:00:00Z')).toISOString()).toBe('2026-11-23T00:00:00.000Z')
    expect(nextDayStart(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('prices each operation at the list rate', () => {
    const writes = costBreakdown({ writes: 100_000 })
    expect(writes.writes).toBeCloseTo(RATE_WRITES_PER_100K, 8)
    const reads = costBreakdown({ reads: 100_000 })
    expect(reads.reads).toBeCloseTo(RATE_READS_PER_100K, 8)
    const deletes = costBreakdown({ deletes: 100_000 })
    expect(deletes.deletes).toBeCloseTo(RATE_DELETES_PER_100K, 8)
    expect(costBreakdown({}).total).toBe(0)
  })

  it('prorates storage, PITR, backup and egress by the gibibyte', () => {
    const cost = costBreakdown({ storageBytes: GIB, bytesRead: GIB })
    expect(cost.storage).toBeCloseTo(0.15, 8)
    expect(cost.pitr).toBeCloseTo(0.15, 8)
    expect(cost.backup).toBeCloseTo(0.03, 8)
    expect(cost.egress).toBeCloseTo(0.12, 8)
    expect(cost.total).toBeCloseTo(0.45, 8)
  })

  it('keeps the old write/read estimate as a subset of the full cost', () => {
    const totals = { writes: 568_480, reads: 4_400 }
    expect(estimateCost(totals)).toBeCloseTo(0.513, 3)
    expect(estimateCost(totals)).toBeCloseTo(costBreakdown(totals).total, 8)
  })

  it('adds deletes and storage to the same day', () => {
    const cost = costBreakdown({
      writes: 100_000,
      reads: 100_000,
      deletes: 100_000,
      storageBytes: 20 * 1024 * 1024,
    })
    expect(cost.total).toBeCloseTo(0.09 + 0.03 + 0.01 + (20 / 1024) * 0.33, 6)
  })

  it('keeps the prepaid top-up floor', () => {
    expect(MIN_TOP_UP_USD).toBe(5)
  })

  it('formats bytes and dollars without losing small amounts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.0031)).toBe('$0.0031')
    expect(formatUsd(0.5116)).toBe('$0.51')
  })
})
