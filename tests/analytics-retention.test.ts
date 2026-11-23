import { describe, expect, it } from 'vitest'
import { EVENT_RETENTION_DAYS, expireAtFrom } from '../src/lib/analytics'

/**
 * Analytics retention is enforced by a Firestore TTL policy on `expireAt`.
 *
 * The policy used to sit on `at`, the moment the event happened, so every
 * document was expired on arrival and the history never grew past a day. These
 * assertions pin the replacement: a dedicated field, computed ahead of time, so
 * retention is a decision and not an accident.
 */
describe('event retention', () => {
  it('is measured in months, not in the arrival of the event', () => {
    expect(EVENT_RETENTION_DAYS).toBeGreaterThanOrEqual(30)
  })

  it('expires in the future, by the configured number of days', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    const expiry = expireAtFrom(now).toMillis()
    const days = (expiry - now) / 86_400_000
    expect(days).toBe(EVENT_RETENTION_DAYS)
    expect(expiry).toBeGreaterThan(now)
  })
})
