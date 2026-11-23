// Polar como merchant of record (E6).
//
// Cobra, factura y liquida (Stripe Connect Express), y acepta comercios en
// Uruguay. Lemon Squeezy cerró las altas nuevas y apaga el 31-mar-2027.
//
// Un producto por pack (`POLAR_PRODUCT_1/5/20`) es el modo normal: cada pack se
// ve y se edita en el dashboard de Polar como cualquier producto.
// Si en cambio se pasa un solo `productId`, el monto va como precio ad-hoc:
//   products: [PRODUCT_ID]
//   prices:   { [PRODUCT_ID]: [{ amount_type: 'fixed', price_amount: cents }] }
//
// Variables: POLAR_ACCESS_TOKEN (polar_oat_…), POLAR_PRODUCT_1/5/20 (o
// POLAR_PRODUCT_ID para el modo ad-hoc), POLAR_WEBHOOK_SECRET y POLAR_SERVER.
import { createHmac, timingSafeEqual } from 'node:crypto'

const BASE_URLS = {
  production: 'https://api.polar.sh/v1',
  sandbox: 'https://sandbox-api.polar.sh/v1',
}

/** Tolerancia del timestamp del webhook (Standard Webhooks). */
const TOLERANCE_SECONDS = 300

const b64 = (buffer) => Buffer.from(buffer).toString('base64')

function safeEqual(a, b) {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Standard Webhooks: `whsec_<base64>` como clave, HMAC-SHA256 sobre
 * `${id}.${timestamp}.${body}` y header `webhook-signature: v1,<base64>`.
 * Los secretos viejos de Polar (antes del 2026-09-08) firmaban el cuerpo en hex
 * con el secreto tal cual; se aceptan los dos para no romper al desplegar.
 */
export function verifySignature({ rawBody, headers, secret, now = Date.now }) {
  if (!secret) return false
  const signature = headers['webhook-signature'] ?? headers['Webhook-Signature']
  if (typeof signature !== 'string' || !signature) return false

  const id = headers['webhook-id'] ?? headers['Webhook-Id'] ?? ''
  const timestamp = headers['webhook-timestamp'] ?? headers['Webhook-Timestamp'] ?? ''

  if (secret.startsWith('whsec_')) {
    if (!id || !timestamp) return false
    const seconds = Number(timestamp)
    if (!Number.isFinite(seconds)) return false
    if (Math.abs(Math.floor(now() / 1000) - seconds) > TOLERANCE_SECONDS) return false

    const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
    const expected = b64(createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest())
    return signature
      .split(' ')
      .map((part) => part.trim())
      .some((part) => part.startsWith('v1,') && safeEqual(part.slice(3), expected))
  }

  // Esquema viejo (Polar HMAC): hex del cuerpo, clave = secreto UTF-8.
  const legacy = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(signature.trim().toLowerCase(), legacy)
}

export function createPolar({
  accessToken,
  productId,
  products = {},
  webhookSecret,
  server = 'production',
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const byPack = Object.fromEntries(
    Object.entries(products)
      .filter(([, id]) => typeof id === 'string' && id)
      .map(([pack, id]) => [Number(pack), id])
  )
  if (!accessToken || (!productId && Object.keys(byPack).length === 0)) {
    throw new Error('polar: faltan POLAR_ACCESS_TOKEN y POLAR_PRODUCT_1/5/20 (o POLAR_PRODUCT_ID)')
  }
  if (!webhookSecret) throw new Error('polar: falta POLAR_WEBHOOK_SECRET')
  const apiBase = BASE_URLS[server]
  if (!apiBase) throw new Error(`polar: POLAR_SERVER inválido (${server})`)

  return {
    name: 'polar',

    /** Sesión de checkout hospedada para el pack pedido. */
    async createSession({ uid, packUsd, email, successUrl }) {
      const pack = Number(packUsd)
      const cents = Math.round(pack * 100)
      if (!Number.isInteger(cents) || cents <= 0) throw new Error('polar: pack inválido')

      const product = byPack[pack]
      if (!product && !productId) throw new Error(`polar: no hay producto para el pack ${pack}`)

      const response = await fetchImpl(`${apiBase}/checkouts/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          // Con un producto por pack el precio sale del catálogo; sin producto
          // propio, el monto viaja como precio ad-hoc del producto único.
          products: [product ?? productId],
          ...(product ? {} : { prices: { [productId]: [{ amount_type: 'fixed', price_amount: cents }] } }),
          // Sin descuentos: el saldo acreditado tiene que ser exactamente el pack.
          allow_discount_codes: false,
          metadata: { uid },
          external_customer_id: uid,
          ...(email ? { customer_email: email } : {}),
          ...(successUrl ? { success_url: successUrl } : {}),
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`polar checkout ${response.status}: ${detail.slice(0, 200)}`)
      }
      const payload = await response.json()
      const url = payload?.url
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('polar: la sesión no trajo una URL https')
      }
      return { url, id: String(payload?.id ?? '') }
    },

    /** Crea el cliente en Polar si todavía no existe; devuelve su id. */
    async ensureCustomer({ uid, email }) {
      const existing = await fetchImpl(`${apiBase}/customers/external/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (existing.ok) {
        const customer = await existing.json()
        return String(customer.id)
      }
      if (existing.status !== 404) {
        throw new Error(`polar customer ${existing.status}`)
      }
      const created = await fetchImpl(`${apiBase}/customers/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ external_id: uid, ...(email ? { email } : {}) }),
      })
      if (!created.ok) {
        const detail = await created.text().catch(() => '')
        throw new Error(`polar customer create ${created.status}: ${detail.slice(0, 160)}`)
      }
      const customer = await created.json()
      return String(customer.id)
    },

    /** ¿Hay al menos una tarjeta guardada? Sin eso no hay cobro off-session. */
    async hasPaymentMethod({ uid }) {
      const response = await fetchImpl(
        `${apiBase}/customers/external/${encodeURIComponent(uid)}/payment-methods`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
      )
      if (!response.ok) return false
      const payload = await response.json()
      return Array.isArray(payload?.items) && payload.items.length > 0
    },

    /** Portal del cliente (Polar): ahí guarda la tarjeta para la recarga automática. */
    async createPortalSession({ uid, returnUrl }) {
      const response = await fetchImpl(`${apiBase}/customer-sessions/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          external_customer_id: uid,
          ...(returnUrl ? { return_url: returnUrl } : {}),
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`polar portal ${response.status}: ${detail.slice(0, 160)}`)
      }
      const payload = await response.json()
      const url = payload?.customer_portal_url
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('polar: el portal no trajo una URL https')
      }
      return { url, id: String(payload?.id ?? '') }
    },

    /**
     * Cobro desatendido contra la tarjeta guardada: orden en borrador + finalize.
     * `amount` sobrescribe el precio del producto, así un mismo producto sirve
     * para cualquier monto. Requiere `orders:write` y el flag
     * `off_session_charges_enabled` en la organización.
     */
    async chargeOffSession({ uid, customerId, productId, amountUsd, description }) {
      const cents = Math.round(Number(amountUsd) * 100)
      if (!customerId) return { status: 'needs-card', reason: 'no-customer' }
      if (!Number.isInteger(cents) || cents <= 0) throw new Error('polar: monto inválido')

      const created = await fetchImpl(`${apiBase}/orders/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          amount: cents,
          currency: 'usd',
          metadata: { uid },
          ...(description ? { description } : {}),
        }),
      })
      if (!created.ok) {
        const detail = await created.text().catch(() => '')
        // Polar rechaza el cobro desatendido al crear la orden cuando la
        // organización no tiene el flag: eso no es un rechazo de la tarjeta.
        if (created.status === 403) {
          return {
            status: 'unavailable',
            reason: 'off-session-disabled',
            detail: detail.slice(0, 200),
          }
        }
        return { status: 'failed', reason: `order-${created.status}`, detail: detail.slice(0, 160) }
      }
      const draft = await created.json()
      const orderId = String(draft.id)

      const finalized = await fetchImpl(`${apiBase}/orders/${orderId}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (finalized.ok) {
        const order = await finalized.json()
        return { status: 'paid', orderId, amountUsd: Number(order?.net_amount ?? cents) / 100 }
      }
      const body = await finalized.json().catch(() => ({}))
      if (finalized.status === 403) {
        // El flag no está prendido en la organización: no es un cobro fallido.
        return { status: 'unavailable', reason: 'off-session-disabled', orderId, detail: body?.detail }
      }
      return {
        status: 'failed',
        reason: finalized.status === 402 ? 'charge-failed' : `finalize-${finalized.status}`,
        orderId,
        detail: body?.detail,
      }
    },

    /**
     * Webhook: `order.paid` con el uid en `data.metadata.uid`. Se acredita el
     * neto (sin impuestos ni descuentos) para que el saldo sea el valor del pack.
     */
    async parseWebhook(rawBody, headers = {}) {
      if (!verifySignature({ rawBody, headers, secret: webhookSecret, now })) {
        throw Object.assign(new Error('invalid-signature'), { status: 401 })
      }
      let event
      try {
        event = JSON.parse(rawBody)
      } catch {
        throw Object.assign(new Error('invalid-json'), { status: 400 })
      }

      const type = event?.type
      if (type !== 'order.paid') {
        return { ignored: true, eventName: String(type ?? '') }
      }
      const order = event?.data ?? {}
      const uid = order?.metadata?.uid
      const eventId = order?.id
      const net = Number(order?.net_amount)
      if (order?.paid === false) return { ignored: true, eventName: type }
      if (typeof uid !== 'string' || !uid || !eventId || !(net > 0)) {
        throw Object.assign(new Error('incomplete-event'), { status: 400 })
      }
      return {
        uid,
        eventId: String(eventId),
        amountUsd: net / 100,
        provider: 'polar',
        // Con esto el proxy puede cobrar off-session más adelante (auto top-up).
        customerId: typeof order?.customer_id === 'string' ? order.customer_id : null,
      }
    },
  }
}
