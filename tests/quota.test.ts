import { describe, expect, it } from 'vitest'
import {
  FREE_TIER,
  agentOpsAllowed,
  freeTierStatus,
  quotaLine,
  quotaWarning,
} from '../src/lib/quota'

describe('free tier quota', () => {
  it('keeps the published limits', () => {
    expect(FREE_TIER.storageBytes).toBe(250 * 1024 * 1024)
    expect(FREE_TIER.agentOpsPerMonth).toBe(10_000)
  })

  it('computes a quota line', () => {
    const line = quotaLine(50, 200)
    expect(line.used).toBe(50)
    expect(line.percent).toBeCloseTo(0.25)
    expect(line.remaining).toBe(150)
    expect(line.over).toBe(false)
  })

  it('clamps negative input and caps the bar at 100%', () => {
    expect(quotaLine(-5, 100).used).toBe(0)
    expect(quotaLine(300, 100).percent).toBe(1)
    expect(quotaLine(300, 100).over).toBe(true)
    expect(quotaLine(5, 0).percent).toBe(1)
  })

  it('flags a soft warning at 80% and a hard one past the limit', () => {
    expect(quotaWarning(quotaLine(79, 100))).toBe('none')
    expect(quotaWarning(quotaLine(80, 100))).toBe('soft')
    expect(quotaWarning(quotaLine(101, 100))).toBe('hard')
  })

  it('reads the free tier status from usage', () => {
    const status = freeTierStatus({
      storageBytes: FREE_TIER.storageBytes / 2,
      agentOps: FREE_TIER.agentOpsPerMonth,
    })
    expect(status.storage.percent).toBeCloseTo(0.5)
    expect(status.agentOps.percent).toBe(1)
    expect(agentOpsAllowed({ agentOps: FREE_TIER.agentOpsPerMonth })).toBe(true)
    expect(agentOpsAllowed({ agentOps: FREE_TIER.agentOpsPerMonth + 1 })).toBe(false)
  })

  it('treats missing usage as zero', () => {
    const status = freeTierStatus(null)
    expect(status.storage.used).toBe(0)
    expect(status.agentOps.used).toBe(0)
  })
})
