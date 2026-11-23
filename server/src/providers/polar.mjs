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
      }
    },
  }
}
