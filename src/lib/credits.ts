import { addDoc, collection, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { db } from '../firebase'
import { MIN_TOP_UP_USD, type Credits } from './usage'

/**
 * Saldo prepago: packs que no vencen y recarga automática opcional.
 *
 * El saldo (`balanceUsd`) y el libro (`credits/{uid}/ledger`) los escribe solo
 * el servidor: un usuario no puede acreditarse plata. Lo que sí puede editar es
 * su configuración de recarga (umbral, monto y si está activa) y pedir una
 * recarga, que queda como solicitud pendiente para que el proveedor de pagos la
 * cobre y acredite. Ver docs/pricing.md §4C.
 */
export const CREDIT_PACKS = [5, 15, 50] as const

/** Precio de las operaciones de agente por volumen. */
export const AGENT_OPS_PRICE_PER_100K = 0.5
/** Precio del GB/mes extra sobre los 250 MB gratis. */
export const EXTRA_STORAGE_PRICE_PER_GB_MONTH = 0.5

export type TopUpStatus = 'pending' | 'paid' | 'cancelled'

export interface CreditSettings {
  thresholdUsd: number
  topUpUsd: number
  autoTopUp: boolean
}

export interface TopUpRequest {
  id: string
  amountUsd: number
  status: TopUpStatus
}

/** Devuelve el primer problema de la configuración, o null si es válida. */
export function validateCreditSettings(settings: CreditSettings): string | null {
  if (!Number.isFinite(settings.thresholdUsd) || settings.thresholdUsd < 0) {
    return 'El umbral no puede ser negativo.'
  }
  if (!Number.isFinite(settings.topUpUsd) || settings.topUpUsd < MIN_TOP_UP_USD) {
    return `La recarga mínima es $${MIN_TOP_UP_USD}.`
  }
  if (settings.autoTopUp && settings.topUpUsd <= settings.thresholdUsd) {
    return 'La recarga tiene que superar el umbral, si no se repite en cada compra.'
  }
  return null
}

/** Guarda solo la configuración; el saldo sigue siendo del servidor. */
export async function updateCreditSettings(
  uid: string,
  settings: CreditSettings,
  firestore: Firestore | null = db
): Promise<void> {
  if (!firestore) throw new Error('Firestore no está disponible.')
  const problem = validateCreditSettings(settings)
  if (problem) throw new Error(problem)
  await setDoc(
    doc(firestore, 'credits', uid),
    {
      thresholdUsd: settings.thresholdUsd,
      topUpUsd: settings.topUpUsd,
      autoTopUp: settings.autoTopUp,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}

/** Pide una recarga; el proveedor la cobra y acredita el saldo después. */
export async function requestTopUp(
  uid: string,
  amountUsd: number,
  firestore: Firestore | null = db
): Promise<string> {
  if (!firestore) throw new Error('Firestore no está disponible.')
  if (!Number.isFinite(amountUsd) || amountUsd < MIN_TOP_UP_USD) {
    throw new Error(`La recarga mínima es $${MIN_TOP_UP_USD}.`)
  }
  const ref = await addDoc(collection(firestore, 'credits', uid, 'topups'), {
    amountUsd,
    status: 'pending',
    requestedAt: serverTimestamp(),
  })
  return ref.id
}

/** ¿El saldo no alcanza para el costo estimado del mes? */
export function needsTopUp(credits: Credits | null, estimatedCostUsd: number): boolean {
  if (!credits) return false
  return credits.balanceUsd < Math.max(0, estimatedCostUsd)
}
