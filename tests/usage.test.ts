import { describe, expect, it } from 'vitest'
import { currentMonth, estimateCost, formatBytes, formatUsd, MIN_TOP_UP_USD } from '../src/lib/usage'

describe('usage accounting', () => {
  it('formats the month as YYYY-MM in UTC', () => {
    expect(currentMonth(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11')
    expect(currentMonth(new Date('2026-01-02T00:10:00Z'))).toBe('2026-01')
  })

  it('estimates cost with the public Firestore rates', () => {
    expect(estimateCost({ reads: 0, writes: 0 })).toBe(0)
    expect(estimateCost({ reads: 100_000, writes: 0 })).toBeCloseTo(0.03, 5)
    expect(estimateCost({ reads: 0, writes: 100_000 })).toBeCloseTo(0.09, 5)
    // A heavy month measured by the sync harness: 568k writes, 4.4k reads.
    expect(estimateCost({ reads: 4_400, writes: 568_480 })).toBeCloseTo(0.5127, 3)
  })

  it('keeps the $2 top-up floor', () => {
    expect(MIN_TOP_UP_USD).toBe(2)
  })

  it('humanizes bytes and amounts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatUsd(0.5127)).toBe('$0.51')
    expect(formatUsd(0.02)).toBe('$0.020')
  })
})
