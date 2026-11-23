// E6: sesión de checkout del MoR y webhook firmado. Sin red: `fetch` y el
// cuerpo del evento se inyectan. El proveedor es Polar (Lemon Squeezy cerró
// las altas nuevas), firma Standard Webhooks + el esquema viejo de Polar.
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createPolar, verifySignature } from '../server/src/providers/polar.mjs'

const SECRET = 'whsec_' + Buffer.from('clave-de-prueba-32-bytes-larga!!').toString('base64')
const LEGACY_SECRET = 'polar_legacy_secret'
const config = {
  accessToken: 'polar_oat_test',
  productId: '1b0f8a2c-0000-4000-8000-000000000001',
  webhookSecret: SECRET,
}

const now = () => Date.parse('2026-11-24T12:00:00.000Z')
const stamp = '1795521600' // 2026-11-24T12:00:00Z

function signStandard(raw: string, id = 'msg_1', timestamp = stamp, secret = SECRET) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }
}

function signLegacy(raw: string, secret = LEGACY_SECRET) {
  return { 'webhook-signature': createHmac('sha256', secret).update(raw).digest('hex') }
}

const orderEvent = JSON.stringify({
  type: 'order.paid',
  timestamp: '2026-11-24T12:00:00Z',
  api_version: '2026-10',
  data: {
    id: 'order_1',
    paid: true,
    status: 'paid',
    net_amount: 500,
    total_amount: 610,
    customer_id: 'cus_1',
    metadata: { uid: 'owner' },
  },
})

describe('firma del webhook', () => {
  it('acepta Standard Webhooks y rechaza firma, timestamp o id cambiados', () => {
    const headers = signStandard(orderEvent)
    expect(verifySignature({ rawBody: orderEvent, headers, secret: SECRET, now })).toBe(true)

    expect(
      verifySignature({
        rawBody: orderEvent + ' ',
        headers,
        secret: SECRET,
        now,
      })
    ).toBe(false)

    // Fuera de la ventana de 5 minutos.
    expect(
      verifySignature({
        rawBody: orderEvent,
        headers: signStandard(orderEvent, 'msg_1', String(Number(stamp) - 600)),
        secret: SECRET,
        now,
      })
    ).toBe(false)

    expect(
      verifySignature({
        rawBody: orderEvent,
        headers: { ...headers, 'webhook-id': 'msg_2' },
        secret: SECRET,
        now,
      })
    ).toBe(false)

    expect(verifySignature({ rawBody: orderEvent, headers, secret: '', now })).toBe(false)
  })

  it('acepta el secreto viejo de Polar (hex sobre el cuerpo)', () => {
    const headers = signLegacy(orderEvent)
    expect(verifySignature({ rawBody: orderEvent, headers, secret: LEGACY_SECRET, now })).toBe(true)
    expect(
      verifySignature({ rawBody: orderEvent + 'x', headers, secret: LEGACY_SECRET, now })
    ).toBe(false)
  })
})

describe('sesión de checkout', () => {
  it('manda el pack como precio ad-hoc del producto', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'cs_1', url: 'https://polar.sh/checkout/cs_1', status: 'open' }),
    }))
    const polar = createPolar({ ...config, fetchImpl })
    const session = await polar.createSession({
      uid: 'owner',
      packUsd: 5,
      email: 'o@x.test',
      successUrl: 'https://app.test/ok',
    })

    expect(session).toEqual({ url: 'https://polar.sh/checkout/cs_1', id: 'cs_1' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.polar.sh/v1/checkouts/')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer polar_oat_test' })
    const body = JSON.parse(String(init.body))
    expect(body.products).toEqual([config.productId])
    expect(body.prices[config.productId]).toEqual([{ amount_type: 'fixed', price_amount: 500 }])
    expect(body.metadata).toEqual({ uid: 'owner' })
    expect(body.external_customer_id).toBe('owner')
    expect(body.allow_discount_codes).toBe(false)
    expect(body.success_url).toBe('https://app.test/ok')
  })

  it('con un producto de precio libre manda el monto en `amount`', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://x.test/c' }) }))
    const polar = createPolar({ ...config, productId: undefined, customProductId: 'prod-custom', fetchImpl })

    await polar.createSession({ uid: 'owner', packUsd: 3.5 })
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.products).toEqual(['prod-custom'])
    expect(body.amount).toBe(350)
    expect(body.prices).toBeUndefined()
    expect(body.metadata).toEqual({ uid: 'owner' })
  })

  it('usa un producto por pack cuando están configurados', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://x.test/c' }) }))
    const polar = createPolar({
      ...config,
      productId: undefined,
      products: { 1: 'prod-1', 5: 'prod-5', 20: 'prod-20' },
      fetchImpl,
    })

    await polar.createSession({ uid: 'owner', packUsd: 5 })
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.products).toEqual(['prod-5'])
    // El precio sale del catálogo: no se manda precio ad-hoc.
    expect(body.prices).toBeUndefined()

    await expect(polar.createSession({ uid: 'owner', packUsd: 7 })).rejects.toThrow('pack 7')
  })

  it('usa el sandbox cuando se pide', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://x.test/c' }) }))
    await createPolar({ ...config, server: 'sandbox', fetchImpl }).createSession({ uid: 'o', packUsd: 1 })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://sandbox-api.polar.sh/v1/checkouts/')
  })

  it('falla si el MoR no devuelve una URL https', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'cs_1' }) }))
    await expect(
      createPolar({ ...config, fetchImpl }).createSession({ uid: 'owner', packUsd: 5 })
    ).rejects.toThrow('URL https')
  })

  it('propaga el error del MoR con el status', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad' }))
    await expect(
      createPolar({ ...config, fetchImpl }).createSession({ uid: 'owner', packUsd: 5 })
    ).rejects.toThrow('422')
  })
})

describe('webhook', () => {
  it('traduce la orden a uid + monto neto', async () => {
    const polar = createPolar({ ...config, now })
    const event = await polar.parseWebhook(orderEvent, signStandard(orderEvent))
    expect(event).toEqual({
      uid: 'owner',
      eventId: 'order_1',
      amountUsd: 5,
      provider: 'polar',
      // Guardado para poder cobrar la recarga automática más adelante.
      customerId: 'cus_1',
    })
  })

  it('rechaza una firma inválida', async () => {
    const polar = createPolar({ ...config, now })
    await expect(
      polar.parseWebhook(orderEvent, { 'webhook-signature': 'v1,deadbeef' })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('ignora eventos que no acreditan saldo', async () => {
    const polar = createPolar({ ...config, now })
    const event = JSON.stringify({ type: 'order.refunded', data: { id: 'order_2' } })
    const parsed = await polar.parseWebhook(event, signStandard(event))
    expect(parsed).toMatchObject({ ignored: true, eventName: 'order.refunded' })
  })

  it('ignora una orden impaga', async () => {
    const polar = createPolar({ ...config, now })
    const event = JSON.stringify({
      type: 'order.paid',
      data: { id: 'order_3', paid: false, net_amount: 500, metadata: { uid: 'owner' } },
    })
    const parsed = await polar.parseWebhook(event, signStandard(event))
    expect(parsed).toMatchObject({ ignored: true })
  })

  it('rechaza un evento sin uid o sin monto', async () => {
    const polar = createPolar({ ...config, now })
    const event = JSON.stringify({
      type: 'order.paid',
      data: { id: 'order_4', paid: true, net_amount: 0, metadata: {} },
    })
    await expect(polar.parseWebhook(event, signStandard(event))).rejects.toMatchObject({ status: 400 })
  })
})
