// E6: sesión de checkout del MoR y webhook firmado. Sin red: `fetch` y el
// cuerpo del evento se inyectan.
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createLemonSqueezy,
  validSignature,
} from '../server/src/providers/lemonsqueezy.mjs'

const SECRET = 'whsec_test'
const config = {
  apiKey: 'key_test',
  storeId: 'store_1',
  variantId: 'variant_1',
  webhookSecret: SECRET,
}

function sign(raw: string, secret = SECRET) {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

describe('firma del webhook', () => {
  it('acepta la firma correcta y rechaza el resto', () => {
    expect(validSignature('{"a":1}', sign('{"a":1}'), SECRET)).toBe(true)
    expect(validSignature('{"a":1}', sign('{"a":1}', 'otro'), SECRET)).toBe(false)
    expect(validSignature('{"a":2}', sign('{"a":1}'), SECRET)).toBe(false)
    expect(validSignature('{"a":1}', '', SECRET)).toBe(false)
    expect(validSignature('{"a":1}', sign('{"a":1}'), '')).toBe(false)
  })
})

describe('sesión de checkout', () => {
  it('manda el monto en centavos y el uid en custom_data', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { id: 'cs_1', attributes: { url: 'https://ls.test/checkout/1' } } }),
    }))
    const ls = createLemonSqueezy({ ...config, fetchImpl })
    const session = await ls.createSession({
      uid: 'owner',
      packUsd: 15,
      email: 'o@x.test',
      successUrl: 'https://app.test/ok',
    })

    expect(session).toEqual({ url: 'https://ls.test/checkout/1', id: 'cs_1' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.lemonsqueezy.com/v1/checkouts')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key_test' })
    const body = JSON.parse(String(init.body))
    expect(body.data.attributes.custom_price).toBe(1500)
    expect(body.data.attributes.checkout_data.custom.uid).toBe('owner')
    expect(body.data.relationships.variant.data.id).toBe('variant_1')
    expect(body.data.relationships.store.data.id).toBe('store_1')
  })

  it('falla si el MoR no devuelve una URL https', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { id: 'cs_1', attributes: {} } }),
    }))
    await expect(
      createLemonSqueezy({ ...config, fetchImpl }).createSession({ uid: 'owner', packUsd: 5 })
    ).rejects.toThrow('URL https')
  })

  it('propaga el error del MoR con el status', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad' }))
    await expect(
      createLemonSqueezy({ ...config, fetchImpl }).createSession({ uid: 'owner', packUsd: 5 })
    ).rejects.toThrow('422')
  })
})

describe('webhook', () => {
  const orderEvent = JSON.stringify({
    meta: { event_name: 'order_created', custom_data: { uid: 'owner' } },
    data: { id: 'order_1', type: 'orders', attributes: { total: 1500, status: 'paid' } },
  })

  it('traduce la orden a uid + monto', async () => {
    const ls = createLemonSqueezy(config)
    const event = await ls.parseWebhook(orderEvent, { 'x-signature': sign(orderEvent) })
    expect(event).toEqual({
      uid: 'owner',
      eventId: 'order_1',
      amountUsd: 15,
      provider: 'lemonsqueezy',
    })
  })

  it('rechaza una firma inválida', async () => {
    const ls = createLemonSqueezy(config)
    await expect(ls.parseWebhook(orderEvent, { 'x-signature': 'deadbeef' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('ignora eventos que no acreditan saldo', async () => {
    const ls = createLemonSqueezy(config)
    const event = JSON.stringify({ meta: { event_name: 'order_refunded' }, data: { id: 'order_2' } })
    const parsed = await ls.parseWebhook(event, { 'x-signature': sign(event) })
    expect(parsed).toMatchObject({ ignored: true, eventName: 'order_refunded' })
  })

  it('ignora una orden que no está paga', async () => {
    const ls = createLemonSqueezy(config)
    const event = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { uid: 'owner' } },
      data: { id: 'order_3', attributes: { total: 500, status: 'pending' } },
    })
    const parsed = await ls.parseWebhook(event, { 'x-signature': sign(event) })
    expect(parsed).toMatchObject({ ignored: true })
  })

  it('rechaza un evento sin uid o sin monto', async () => {
    const ls = createLemonSqueezy(config)
    const event = JSON.stringify({
      meta: { event_name: 'order_created' },
      data: { id: 'order_4', attributes: { total: 500, status: 'paid' } },
    })
    await expect(ls.parseWebhook(event, { 'x-signature': sign(event) })).rejects.toMatchObject({
      status: 400,
    })
  })
})
