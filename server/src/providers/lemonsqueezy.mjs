// Lemon Squeezy como merchant of record (E6).
//
// Stripe no opera en Uruguay (docs/comercial-review.md §1), así que el MoR
// cobra, factura y remite. El proxy solo crea la sesión de checkout y acredita
// saldo cuando el webhook firmado confirma el pago.
//
// Variables: LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID,
// LEMONSQUEEZY_VARIANT_ID y LEMONSQUEEZY_WEBHOOK_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto'

const JSON_API = 'application/vnd.api+json'

function signatureOf(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function validSignature(rawBody, signature, secret) {
  if (typeof signature !== 'string' || !signature || !secret) return false
  const expected = Buffer.from(signatureOf(rawBody, secret), 'utf8')
  const received = Buffer.from(signature.trim().toLowerCase(), 'utf8')
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export function createLemonSqueezy({
  apiKey,
  storeId,
  variantId,
  webhookSecret,
  apiBase = 'https://api.lemonsqueezy.com/v1',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || !storeId || !variantId) {
    throw new Error('lemonsqueezy: faltan LEMONSQUEEZY_API_KEY/STORE_ID/VARIANT_ID')
  }
  if (!webhookSecret) throw new Error('lemonsqueezy: falta LEMONSQUEEZY_WEBHOOK_SECRET')

  return {
    name: 'lemonsqueezy',

    /** Sesión de checkout hospedada; el monto se fija en centavos. */
    async createSession({ uid, packUsd, email, successUrl, cancelUrl }) {
      const response = await fetchImpl(`${apiBase}/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: JSON_API,
          'Content-Type': JSON_API,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              custom_price: Math.round(Number(packUsd) * 100),
              // Lemon Squeezy solo tiene un `redirect_url` tras el pago; el
              // usuario vuelve a la app, que consulta el saldo.
              product_options: {
                ...(successUrl ? { redirect_url: successUrl } : {}),
                ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
              },
              checkout_data: {
                ...(email ? { email } : {}),
                custom: { uid },
              },
            },
            relationships: {
              store: { data: { type: 'stores', id: String(storeId) } },
              variant: { data: { type: 'variants', id: String(variantId) } },
            },
          },
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`lemonsqueezy checkout ${response.status}: ${detail.slice(0, 200)}`)
      }
      const payload = await response.json()
      const url = payload?.data?.attributes?.url
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('lemonsqueezy: la sesión no trajo una URL https')
      }
      return { url, id: String(payload?.data?.id ?? '') }
    },

    /**
     * Webhook: firma HMAC-SHA256 hex en `X-Signature`, uid en
     * `meta.custom_data.uid` y monto en `data.attributes.total` (centavos).
     */
    async parseWebhook(rawBody, headers = {}) {
      const signature = headers['x-signature'] ?? headers['X-Signature']
      if (!validSignature(rawBody, signature, webhookSecret)) {
        throw Object.assign(new Error('invalid-signature'), { status: 401 })
      }
      let event
      try {
        event = JSON.parse(rawBody)
      } catch {
        throw Object.assign(new Error('invalid-json'), { status: 400 })
      }
      const name = event?.meta?.event_name
      if (name !== 'order_created') {
        // Otros eventos se aceptan y se ignoran: no acreditan saldo.
        return { ignored: true, eventName: String(name ?? '') }
      }
      const uid = event?.meta?.custom_data?.uid
      const eventId = event?.data?.id
      const totalCents = Number(event?.data?.attributes?.total ?? 0)
      const status = event?.data?.attributes?.status
      if (status && status !== 'paid') return { ignored: true, eventName: name }
      if (typeof uid !== 'string' || !uid || !eventId || !(totalCents > 0)) {
        throw Object.assign(new Error('incomplete-event'), { status: 400 })
      }
      return {
        uid,
        eventId: String(eventId),
        amountUsd: totalCents / 100,
        provider: 'lemonsqueezy',
      }
    },
  }
}
