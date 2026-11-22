import { addDoc, collection, serverTimestamp, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Minimal, privacy-respecting product analytics.
 *
 * - Seven fixed event names (validated by security rules), no free text
 * - At most one write per event name per browser session (deduplicated)
 * - No third-party script, no identifiers beyond the uid that already owns the data
 * - Fire-and-forget: analytics never blocks the UI
 */
export const EVENTS = [
  'app_open',
  'note_created',
  'note_shared',
  'collab_session',
  'agent_linked',
  'export',
  'import',
  // Funnel events. A guest has no uid, so they are counted locally and flushed
  // into the account's collection on the first sign-in (see guestAnalytics.ts).
  'landing_viewed',
  'pricing_viewed',
  'guest_draft_started',
  'guest_signin_clicked',
  'guest_draft_saved',
] as const

export type EventName = (typeof EVENTS)[number]

const sent = new Set<EventName>()

export function resetAnalyticsForTests(): void {
  sent.clear()
}

export function track(
  name: EventName,
  uid: string | undefined,
  props: Record<string, string | number> = {},
  firestore: Firestore | null = db
): void {
  if (!uid || !firestore) return
  if (sent.has(name)) return
  sent.add(name)

  // Rules limit props to 5 short string values; numbers become strings here.
  const safeProps: Record<string, string> = {}
  Object.entries(props)
    .slice(0, 5)
    .forEach(([key, value]) => {
      safeProps[key.slice(0, 24)] = String(value).slice(0, 100)
    })

  void addDoc(collection(firestore, 'analytics', uid, 'events'), {
    name,
    props: safeProps,
    at: serverTimestamp(),
  }).catch(() => undefined)
}
