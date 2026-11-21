import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Collaborator lookup without a backend.
 *
 * Each user publishes `userIndex/{sha256(email)}` with their uid. Entries are
 * reachable one by one but not listable (rules deny `list`), so somebody can
 * only resolve an address they already know — the same privacy level as any
 * "add collaborator by email" flow.
 */
export async function emailHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function publishOwnDirectoryEntry(
  uid: string,
  email: string | null | undefined,
  name: string | null | undefined
): Promise<void> {
  if (!db) return
  const displayName = (name || email?.split('@')[0] || 'Sin nombre').slice(0, 120)

  // Public display name, used by the share panel to label members.
  await setDoc(doc(db, 'profiles', uid), { name: displayName, updatedAt: serverTimestamp() })

  if (!email) return
  const id = await emailHash(email)
  await setDoc(doc(db, 'userIndex', id), {
    uid,
    email: email.trim().toLowerCase(),
    name: displayName,
    updatedAt: serverTimestamp(),
  })
}

export async function getProfileName(uid: string): Promise<string | null> {
  if (!db) return null
  const snap = await getDoc(doc(db, 'profiles', uid))
  return snap.exists() ? ((snap.data().name as string) ?? null) : null
}

export interface DirectoryEntry {
  uid: string
  email: string
  name: string
}

export async function lookupByEmail(email: string): Promise<DirectoryEntry | null> {
  if (!db) return null
  const id = await emailHash(email)
  const snap = await getDoc(doc(db, 'userIndex', id))
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data?.uid) return null
  return { uid: data.uid as string, email: data.email as string, name: data.name as string }
}
