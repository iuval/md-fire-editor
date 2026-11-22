import { describe, expect, it, vi } from 'vitest'
import {
  GUEST_EVENTS_KEY,
  clearGuestEvents,
  flushGuestEvents,
  readGuestEvents,
  trackGuest,
} from '../src/lib/guestAnalytics'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

describe('guest funnel counter', () => {
  it('counts events locally', () => {
    const store = memoryStorage()
    trackGuest('landing_viewed', store)
    trackGuest('landing_viewed', store)
    trackGuest('pricing_viewed', store)
    expect(readGuestEvents(store)).toEqual({ landing_viewed: 2, pricing_viewed: 1 })
  })

  it('ignores corrupt counters', () => {
    const store = memoryStorage()
    store.setItem(GUEST_EVENTS_KEY, '{oops')
    expect(readGuestEvents(store)).toEqual({})
  })

  it('clears the counter', () => {
    const store = memoryStorage()
    trackGuest('landing_viewed', store)
    clearGuestEvents(store)
    expect(readGuestEvents(store)).toEqual({})
  })

  it('flushes to the signed-in account and clears the local counter', () => {
    const store = memoryStorage()
    trackGuest('landing_viewed', store)
    trackGuest('guest_draft_started', store)
    const track = vi.fn()

    flushGuestEvents('uid-1', { track }, store)

    expect(track).toHaveBeenCalledWith('landing_viewed', 'uid-1', { count: 1 })
    expect(track).toHaveBeenCalledWith('guest_draft_started', 'uid-1', { count: 1 })
    expect(readGuestEvents(store)).toEqual({})
  })
})
