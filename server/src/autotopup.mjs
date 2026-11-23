// Recarga automática: cuando el débito deja el saldo bajo el umbral, el proxy
// cobra contra la tarjeta guardada en Polar (cobro off-session) y el webhook
// `order.paid` acredita el saldo como cualquier otra recarga.
//
// El saldo sigue siendo nuestro (`credits/{uid}.balanceUsd`): Polar solo cobra.
// Este módulo no escribe en Firestore; solo dispara el cobro.
import { MIN_AUTO_TOP_UP_USD } from './core.mjs'

/** Elige el producto del catálogo para el monto pedido. */
export function productForAmount(products, amountUsd) {
  const byAmount = products ?? {}
  if (byAmount[amountUsd]) return byAmount[amountUsd]
  // Un monto fuera del catálogo (p. ej. $10) usa el pack de $5 con `amount`
  // override: Polar acepta el monto explícito sobre un producto de precio fijo.
  if (byAmount[MIN_AUTO_TOP_UP_USD]) return byAmount[MIN_AUTO_TOP_UP_USD]
  const first = Object.values(byAmount)[0]
  return typeof first === 'string' ? first : null
}

/**
 * Ejecuta la recarga pedida por el core. Devuelve siempre un resultado
 * explicable; nunca tira, porque corriendo después de un débito exitoso un
 * error de cobro no puede romper la respuesta al cliente.
 */
export async function runAutoTopUp({ polar, products, request }) {
  if (!request) return null
  if (!polar) return { status: 'unavailable', reason: 'no-provider' }

  const amountUsd = Math.max(MIN_AUTO_TOP_UP_USD, Number(request.amountUsd) || 0)
  if (!request.customerId) {
    // El usuario todavía no tiene cliente en Polar: falta guardar la tarjeta.
    return { status: 'needs-card', reason: 'no-customer', amountUsd }
  }
  const productId = productForAmount(products, amountUsd)
  if (!productId) return { status: 'unavailable', reason: 'no-product', amountUsd }

  try {
    const result = await polar.chargeOffSession({
      uid: request.uid,
      customerId: request.customerId,
      productId,
      amountUsd,
      description: `Firemd Credits — $${amountUsd}`,
    })
    return { ...result, amountUsd }
  } catch (error) {
    return { status: 'failed', reason: 'error', detail: error?.message, amountUsd }
  }
}
