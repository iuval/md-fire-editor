import { describe, expect, it } from 'vitest'
import {
  CREDIT_PACKS,
  EXTRA_STORAGE_PRICE_PER_GB_MONTH,
  AGENT_OPS_PRICE_PER_100K,
  creditExpiryDate,
  needsTopUp,
  validateCreditSettings,
} from '../src/lib/credits'
import { CREDIT_EXPIRY_MONTHS } from '../src/lib/usage'

describe('prepaid credits', () => {
  it('offers packs that expire after 24 months', () => {
    expect([...CREDIT_PACKS]).toEqual([5, 15, 50])
    expect(CREDIT_EXPIRY_MONTHS).toBe(24)
    expect(creditExpiryDate(new Date('2026-11-22T00:00:00Z')).toISOString()).toBe(
      '2028-11-01T00:00:00.000Z'
    )
  })

  it('prices agent operations and extra storage at the published rates', () => {
    expect(AGENT_OPS_PRICE_PER_100K).toBe(0.5)
    expect(EXTRA_STORAGE_PRICE_PER_GB_MONTH).toBe(0.6)
  })

  it('rejects invalid settings', () => {
    expect(
      validateCreditSettings({ thresholdUsd: -1, topUpUsd: 5, autoTopUp: false })
    ).toMatch(/negative/)
    expect(
      validateCreditSettings({ thresholdUsd: 1, topUpUsd: 1, autoTopUp: false })
    ).toMatch(/minimum/i)
    expect(
      validateCreditSettings({ thresholdUsd: 5, topUpUsd: 5, autoTopUp: true })
    ).toMatch(/above the threshold/i)
    expect(
      validateCreditSettings({ thresholdUsd: 2, topUpUsd: 5, autoTopUp: true })
    ).toBeNull()
  })

  it('does not need a top-up without credits or without an estimated cost', () => {
    expect(needsTopUp(null, 0.5)).toBe(false)
    expect(
      needsTopUp({ balanceUsd: 0, thresholdUsd: 1, topUpUsd: 5, autoTopUp: false }, 0)
    ).toBe(false)
  })

  it('needs a top-up when the balance is below the estimated cost', () => {
    const credits = { balanceUsd: 0.2, thresholdUsd: 1, topUpUsd: 5, autoTopUp: false }
    expect(needsTopUp(credits, 0.5)).toBe(true)
    expect(needsTopUp({ ...credits, balanceUsd: 2 }, 0.5)).toBe(false)
  })
})
