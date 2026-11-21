import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export type Plan = 'free' | 'paid'

export interface Entitlement {
  plan: Plan
  source: string
  expiresAt?: { seconds: number } | null
}

/**
 * Plans live in `entitlements/{uid}` and can only be written by an admin
 * (see firestore.rules). Absent document means `free`.
 *
 * Payments are not integrated yet, so plans are granted manually; the client
 * only reads them. Sharing and agent linking are gated on `plan === 'paid'`.
 */
export function subscribeEntitlement(
  uid: string,
  onChange: (entitlement: Entitlement) => void
): () => void {
  if (!db) return () => undefined
  return onSnapshot(
    doc(db, 'entitlements', uid),
    (snap) => {
      const data = snap.data()
      const expiresAt = (data?.expiresAt as { seconds: number } | null) ?? null
      const expired = !!expiresAt && expiresAt.seconds * 1000 < Date.now()
      onChange({
        plan: data?.plan === 'paid' && !expired ? 'paid' : 'free',
        source: (data?.source as string) ?? 'default',
        expiresAt,
      })
    },
    () => onChange({ plan: 'free', source: 'error' })
  )
}

export function isPaid(entitlement: Entitlement | null): boolean {
  return entitlement?.plan === 'paid'
}
