import { track } from './analytics'

/**
 * Funnel counting for visitors without an account.
 *
 * `track()` needs a uid and the rules only accept writes to the owner's own
 * collection, so a guest cannot write to Firestore without inventing an
 * identity (which the product explicitly does not do). The alternative is a
 * local counter: it survives reloads, needs no permission, and is flushed into
 * the account's analytics collection on the first sign-in — the funnel is still
 * measurable, without an anonymous account or a third-party script.
 */

export const GUEST_EVENTS_KEY = 'firemd-guest-events'

export const GUEST_EVENTS = [
  'landing_viewed',
  'pricing_viewed',
  'guest_draft_started',
  'guest_signin_clicked',
  'guest_draft_saved',
] as const

export type GuestEvent = (typeof GUEST_EVENTS)[number]

export type GuestEventCounts = Partial<Record<GuestEvent, number>>

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readGuestEvents(store: Storage | null = defaultStorage()): GuestEventCounts {
  if (!store) return {}
  try {
    const raw = store.getItem(GUEST_EVENTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return {}
    const counts: GuestEventCounts = {}
    for (const name of GUEST_EVENTS) {
      const value = parsed[name]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        counts[name] = Math.floor(value)
      }
    }
    return counts
  } catch {
    return {}
  }
}

export function trackGuest(
  name: GuestEvent,
  store: Storage | null = defaultStorage()
): GuestEventCounts {
  const counts = readGuestEvents(store)
  counts[name] = (counts[name] ?? 0) + 1
  try {
    store?.setItem(GUEST_EVENTS_KEY, JSON.stringify(counts))
  } catch {
    /* storage full or disabled: the in-memory count is enough for this page */
  }
  return counts
}

export function clearGuestEvents(store: Storage | null = defaultStorage()): void {
  try {
    store?.removeItem(GUEST_EVENTS_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * Sends the locally counted events to the freshly signed-in account. `track`
 * deduplicates per browser session, so a reload cannot double count. The local
 * counter is cleared only after the calls are dispatched.
 */
export function flushGuestEvents(
  uid: string,
  deps: { track: typeof track } = { track },
  store: Storage | null = defaultStorage()
): GuestEventCounts {
  const counts = readGuestEvents(store)
  for (const name of GUEST_EVENTS) {
    const count = counts[name]
    if (!count) continue
    deps.track(name, uid, { count })
  }
  clearGuestEvents(store)
  return counts
}
