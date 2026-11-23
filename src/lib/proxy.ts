import { auth } from '../firebase'
import { t } from '../i18n/index.ts'

/**
 * Cliente del proxy prepago (Cloud Run). Es el único escritor de datos de
 * usuario cuando está configurado: el proxy resuelve ACL, cuota y saldo, y
 * debita en la misma transacción. Sin `VITE_PROXY_URL` la app sigue escribiendo
 * directo a Firestore (modo desarrollo y transición de E2).
 *
 * Ver docs/prepaid-usage-model.md §3.4-§3.6.
 */
const base = ((import.meta.env.VITE_PROXY_URL as string | undefined) ?? '').replace(/\/+$/, '')

export const proxyEnabled = base !== ''

export type AccountState =
  | 'free'
  | 'paid'
  | 'low'
  | 'free-exhausted'
  | 'pay-exhausted'
  | 'storage-over'
  | 'admin'

export interface Allowance {
  day: string
  opsUsed: number
  quota: number
  remaining: number
  renewsAt: string
}

export interface Receipt {
  id: string
  kind: 'block' | 'body' | 'compact'
  idempotent: boolean
  chargeUsd: number
  balanceUsd: number
  state: AccountState
  allowance: Allowance
}

export interface Account {
  day: string
  opsUsed: number
  quota: number
  remaining: number
  renewsAt: string
  storageBytes: number
  storageLimit: number
  balanceUsd: number
  thresholdUsd: number
  autoTopUp: boolean
  admin: boolean
  state: AccountState
}

/** Rechazo de negocio del proxy: no es un fallo de red, es un tope. */
export class ProxyRejection extends Error {
  code = 'quota'
  state: AccountState

  constructor(message: string, state: AccountState) {
    super(message)
    this.name = 'ProxyRejection'
    this.state = state
  }
}

function rejectionMessage(state: AccountState): string {
  if (state === 'storage-over') return t('error.storageOver')
  if (state === 'pay-exhausted') return t('error.balanceExhausted')
  return t('error.quotaExhausted')
}

/** Idempotencia: el mismo opId no se cobra dos veces. */
export function newOpId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth?.currentUser
  if (!user) throw new Error(t('error.firebaseNotConfigured'))
  const token = await user.getIdToken()
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { state?: AccountState; error?: string }
    if (response.status === 402) {
      const state = body.state ?? 'free-exhausted'
      throw new ProxyRejection(rejectionMessage(state), state)
    }
    throw new Error(body.error ?? `proxy ${response.status}`)
  }
  return (await response.json()) as T
}

export function postBlock(
  noteId: string,
  block: { v: number; jid: number; hash: string; bytes: number; data: string; clientId: number }
): Promise<Receipt> {
  return call<Receipt>(`/v1/notes/${encodeURIComponent(noteId)}/blocks`, {
    method: 'POST',
    body: JSON.stringify({ opId: newOpId(), block }),
  })
}

export function postBody(
  noteId: string,
  body: { markdown: string; title?: string; tags?: string[]; version?: number; maxChars?: number }
): Promise<Receipt> {
  return call<Receipt>(`/v1/notes/${encodeURIComponent(noteId)}/body`, {
    method: 'POST',
    body: JSON.stringify({ opId: newOpId(), body }),
  })
}

export interface Manifest {
  epoch: number
  snapshot: string
  stateVector: string
  jid: number
  bytes: number
  clientId: number
}

/**
 * Compactación server-side: manda el snapshot ya aplicado y los ids que quedaron
 * plegados en él. El proxy escribe el manifest y borra esos bloques, cobrando
 * los borrados. Un bloque escrito mientras tanto no está en la lista, así que
 * no se pierde.
 */
export function postCompact(
  noteId: string,
  compaction: { blockIds: string[]; manifest: Manifest }
): Promise<Receipt> {
  return call<Receipt>(`/v1/notes/${encodeURIComponent(noteId)}/compact`, {
    method: 'POST',
    body: JSON.stringify({ opId: newOpId(), compact: compaction }),
  })
}

export function fetchAccount(): Promise<Account> {
  return call<Account>('/v1/account')
}

/** Sesión de checkout del MoR para cargar saldo (E6). */
/** Portal de Polar: ahí el usuario guarda la tarjeta que usa la recarga automática. */
export function startPortal(): Promise<{ url: string; id: string }> {
  return call<{ url: string; id: string }>('/v1/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ returnUrl: `${location.origin}/?portal=ok` }),
  })
}

/** Sesión de checkout del MoR para cargar saldo: cualquier monto del rango (E6). */
export function startCheckout(amountUsd: number): Promise<{ url: string; amountUsd: number }> {
  return call<{ url: string; amountUsd: number }>('/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ amountUsd, successUrl: `${location.origin}/?topup=ok` }),
  })
}
