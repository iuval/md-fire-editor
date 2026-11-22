import { describe, expect, it } from 'vitest'
import {
  FREE_TIER,
  agentOpsAllowed,
  freeTierStatus,
  quotaLine,
  quotaWarning,
  unlimitedQuota,
} from '../src/lib/quota'

describe('free tier quota', () => {
  it('keeps the published monthly limits', () => {
    expect(FREE_TIER.storageBytes).toBe(100 * 1024 * 1024)
    expect(FREE_TIER.opsPerMonth).toBe(20_000)
    expect(FREE_TIER.agentOpsPerMonth).toBe(FREE_TIER.opsPerMonth)
  })

  it('computes a quota line', () => {
    const line = quotaLine(50, 100)
    expect(line.used).toBe(50)
    expect(line.percent).toBeCloseTo(0.5)
    expect(line.remaining).toBe(50)
    expect(line.over).toBe(false)
  })

  it('clamps negative input and caps the bar at 100%', () => {
    expect(quotaLine(-10, 100).used).toBe(0)
    expect(quotaLine(50, 100).percent).toBeCloseTo(0.5)
    expect(quotaLine(150, 100).percent).toBe(1)
    expect(quotaLine(150, 100).over).toBe(true)
    expect(quotaLine(50, 0).percent).toBe(1)
  })

  it('flags a soft warning at 80% and a hard warning past the limit', () => {
    expect(quotaWarning(quotaLine(79, 100))).toBe('none')
    expect(quotaWarning(quotaLine(80, 100))).toBe('soft')
    expect(quotaWarning(quotaLine(101, 100))).toBe('hard')
  })

  it('reads the monthly quota status', () => {
    const status = freeTierStatus({
      storageBytes: FREE_TIER.storageBytes / 2,
      agentOps: FREE_TIER.opsPerMonth,
    })
    expect(status.storage.percent).toBeCloseTo(0.5)
    expect(status.ops.percent).toBe(1)
    expect(status.agentOps).toBe(status.ops)
    expect(agentOpsAllowed({ agentOps: FREE_TIER.opsPerMonth })).toBe(true)
    expect(agentOpsAllowed({ agentOps: FREE_TIER.opsPerMonth + 1 })).toBe(false)
  })

  it('treats missing usage as zero', () => {
    const status = freeTierStatus(null)
    expect(status.storage.used).toBe(0)
    expect(status.ops.used).toBe(0)
  })

  it('gives admins an unlimited quota and no warning', () => {
    const status = freeTierStatus({ storageBytes: 10 ** 12, agentOps: 10 ** 9 }, true)
    expect(status.storage.unlimited).toBe(true)
    expect(status.ops.unlimited).toBe(true)
    expect(status.storage.used).toBe(10 ** 12)
    expect(quotaWarning(status.storage)).toBe('none')
    expect(agentOpsAllowed({ agentOps: 10 ** 9 }, true)).toBe(true)
    expect(unlimitedQuota(5).unlimited).toBe(true)
  })
})
