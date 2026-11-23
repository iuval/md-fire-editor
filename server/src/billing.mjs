// Acreditar saldo: la única pieza del proxy que suma plata. Todo lo demás
// resta (débito por operación) o lee.
import {
  CREDIT_EXPIRY_MONTHS,
  MIN_TOP_UP_USD,
  docPath,
  roundUsd,
} from './core.mjs'

/** El saldo vence a los 24 meses (D3), contados desde la acreditación. */
export function expiryFrom(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + CREDIT_EXPIRY_MONTHS, now.getUTCDate())
  )
}

/**
 * Acredita una recarga confirmada por el MoR. Es idempotente por evento del
 * proveedor: el webhook puede reintentar sin duplicar el saldo.
 */
export async function creditTopUp(
  store,
  { uid, amountUsd, eventId, provider = 'unknown', customerId = null, now = new Date() }
) {
  if (typeof uid !== 'string' || !uid) throw new Error('missing-uid')
  if (typeof eventId !== 'string' || !eventId) throw new Error('missing-event-id')
  const amount = roundUsd(amountUsd)
  if (!(amount >= MIN_TOP_UP_USD)) throw new Error('amount-below-minimum')

  const paymentPath = docPath.payment(provider, eventId)
  const expiresAt = expiryFrom(now).toISOString()

  return store.runTransaction(async (tx) => {
    if (await tx.get(paymentPath)) {
      return { ok: true, idempotent: true, eventId }
    }
    const credits = (await tx.get(docPath.credits(uid))) ?? {}
    const balanceUsd = roundUsd((credits.balanceUsd ?? 0) + amount)
    tx.set(
      docPath.credits(uid),
      {
        balanceUsd,
        totalToppedUpUsd: roundUsd((credits.totalToppedUpUsd ?? 0) + amount),
        // Guardado para poder cobrar la próxima recarga sin el usuario.
        ...(customerId ? { polarCustomerId: customerId } : {}),
        expiresAt,
        updatedAt: now,
      },
      { merge: true }
    )
    tx.set(docPath.ledger(uid, tx.newId()), {
      kind: 'topup',
      amountUsd: amount,
      provider,
      eventId,
      expiresAt,
      at: now.toISOString(),
    })
    tx.set(paymentPath, {
      uid,
      amountUsd: amount,
      provider,
      eventId,
      creditedAt: now.toISOString(),
    })
    return { ok: true, idempotent: false, eventId, balanceUsd, expiresAt }
  })
}
