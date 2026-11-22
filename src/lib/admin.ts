import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Cuentas admin: no pagan y no tienen tope de cuota.
 *
 * El admin se marca en `admins/{uid}`. Para el arranque hay un bootstrap por
 * email: la cuenta de la persona que opera el producto se auto-crea el
 * documento al entrar. El email está también en `firestore.rules`, así que la
 * regla acepta el alta sin depender de que la app haya corrido antes.
 */
export const ADMIN_EMAIL = 'iuvalgoldansky@gmail.com'

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && email!.toLowerCase() === ADMIN_EMAIL
}

/** Lee `admins/{uid}`. Devuelve false si no hay documento o si falla la red. */
export async function fetchIsAdmin(uid: string, firestore: Firestore | null = db): Promise<boolean> {
  if (!firestore) return false
  try {
    const snap = await getDoc(doc(firestore, 'admins', uid))
    return snap.exists()
  } catch {
    return false
  }
}

/**
 * Crea el documento de admin para el bootstrap por email. Es idempotente: si
 * ya existe, no lo toca. Devuelve si la cuenta es admin por email aunque el
 * alta falle (offline), para que la UI no muestre un tope que no aplica.
 */
export async function ensureAdminDoc(
  uid: string,
  email: string | null | undefined,
  firestore: Firestore | null = db
): Promise<boolean> {
  if (!isAdminEmail(email)) return false
  if (!firestore) return true
  try {
    const ref = doc(firestore, 'admins', uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      await setDoc(ref, { createdAt: serverTimestamp(), email: ADMIN_EMAIL })
    }
  } catch {
    // Best-effort: el email ya alcanza para que las reglas lo traten como admin.
  }
  return true
}

/** Resuelve el estado de admin de una sesión: email primero, documento después. */
export async function resolveIsAdmin(
  uid: string,
  email: string | null | undefined,
  firestore: Firestore | null = db
): Promise<boolean> {
  if (isAdminEmail(email)) {
    void ensureAdminDoc(uid, email, firestore)
    return true
  }
  return fetchIsAdmin(uid, firestore)
}
