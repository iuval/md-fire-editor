// Recarga automática: política (cuándo y con qué producto) + llamadas al MoR.
// Sin red: el adaptador de Polar recibe un `fetch` falso.
import { describe, expect, it, vi } from 'vitest'
import { productForAmount, runAutoTopUp } from '../server/src/autotopup.mjs'
import { createPolar } from '../server/src/providers/polar.mjs'

const SECRET = 'whsec_' + Buffer.from('clave-de-prueba-32-bytes-larga!!').toString('base64')
const config = {
  accessToken: 'polar_oat_test',
  products: { 1: 'prod-1', 5: 'prod-5', 20: 'prod-20' },
  webhookSecret: SECRET,
}
const request = { uid: 'owner', amountUsd: 5, customerId: 'cus_1' }

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

describe('política de recarga', () => {
  it('usa el producto del monto y cae al pack de $5 con override', () => {
    const products = { 1: 'p1', 5: 'p5', 20: 'p20' }
    expect(productForAmount(products, 5)).toBe('p5')
    expect(productForAmount(products, 20)).toBe('p20')
    // $10 no está en el catálogo: se cobra con el producto de $5 + amount.
    expect(productForAmount(products, 10)).toBe('p5')
    expect(productForAmount({ 20: 'p20' }, 10)).toBe('p20')
    expect(productForAmount({}, 10)).toBeNull()
  })

  it('sin proveedor o sin tarjeta guardada no intenta cobrar', async () => {
    expect(await runAutoTopUp({ polar: null, products: {}, request })).toMatchObject({
      status: 'unavailable',
      reason: 'no-provider',
    })
    expect(await runAutoTopUp({ polar: {}, products: {}, request: { ...request, customerId: null } })).toMatchObject({
      status: 'needs-card',
      reason: 'no-customer',
    })
    expect(await runAutoTopUp({ polar: {}, products: {}, request: null })).toBeNull()
  })
})

describe('cobro off-session contra Polar', () => {
  it('crea la orden con el monto y la finaliza', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/orders/')) {
        return jsonResponse({ id: 'order_1', status: 'draft' }, 201)
      }
      return jsonResponse({ id: 'order_1', status: 'paid', paid: true, net_amount: 500 })
    })
    const polar = createPolar({ ...config, fetchImpl })
    const result = await runAutoTopUp({ polar, products: config.products, request })

    expect(result).toMatchObject({ status: 'paid', orderId: 'order_1', amountUsd: 5 })
    const [createUrl, createInit] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(createUrl).toBe('https://api.polar.sh/v1/orders/')
    const body = JSON.parse(String(createInit.body))
    expect(body).toMatchObject({
      customer_id: 'cus_1',
      product_id: 'prod-5',
      amount: 500,
      currency: 'usd',
      metadata: { uid: 'owner' },
    })
    const [finalizeUrl] = fetchImpl.mock.calls[1] as [string]
    expect(finalizeUrl).toBe('https://api.polar.sh/v1/orders/order_1/finalize')
  })

  it('sin el flag de la organización devuelve unavailable, no failed', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/orders/')
        ? jsonResponse({ id: 'order_2' }, 201)
        : jsonResponse({ error: 'OffSessionChargesNotEnabled', detail: 'not enabled' }, 403)
    )
    const result = await runAutoTopUp({
      polar: createPolar({ ...config, fetchImpl }),
      products: config.products,
      request,
    })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'off-session-disabled', orderId: 'order_2' })
  })

  it('sin el flag, Polar rechaza al crear la orden: unavailable', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () =>
        '{"error":"OffSessionChargesNotEnabled","detail":"Off-session charges are not enabled"}',
    }))
    const result = await runAutoTopUp({
      polar: createPolar({ ...config, fetchImpl }),
      products: config.products,
      request,
    })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'off-session-disabled' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('un rechazo de la tarjeta queda como failed con el detalle', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/orders/')
        ? jsonResponse({ id: 'order_3' }, 201)
        : jsonResponse({ error: 'PaymentFailed', detail: 'card declined' }, 402)
    )
    const result = await runAutoTopUp({
      polar: createPolar({ ...config, fetchImpl }),
      products: config.products,
      request,
    })
    expect(result).toMatchObject({ status: 'failed', reason: 'charge-failed', detail: 'card declined' })
  })

  it('si crear la orden falla no se finaliza nada', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'bad' }, 422))
    const result = await runAutoTopUp({
      polar: createPolar({ ...config, fetchImpl }),
      products: config.products,
      request,
    })
    expect(result).toMatchObject({ status: 'failed', reason: 'order-422' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('portal de tarjetas', () => {
  it('crea el cliente si no existe y devuelve la URL del portal', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/customers/external/')) return jsonResponse({ detail: 'not found' }, 404)
      if (url.endsWith('/customers/')) return jsonResponse({ id: 'cus_9' }, 201)
      return jsonResponse({ id: 'cs_9', customer_portal_url: 'https://polar.sh/portal/abc' }, 201)
    })
    const polar = createPolar({ ...config, fetchImpl })
    const customerId = await polar.ensureCustomer({ uid: 'owner', email: 'o@x.test' })
    expect(customerId).toBe('cus_9')

    const session = await polar.createPortalSession({ uid: 'owner', returnUrl: 'https://app.test/ok' })
    expect(session).toEqual({ url: 'https://polar.sh/portal/abc', id: 'cs_9' })
    const sessionInit = fetchImpl.mock.calls[2][1] as RequestInit
    expect(JSON.parse(String(sessionInit.body))).toMatchObject({
      external_customer_id: 'owner',
      return_url: 'https://app.test/ok',
    })
  })

  it('detecta si hay tarjeta guardada', async () => {
    const withCard = createPolar({
      ...config,
      fetchImpl: vi.fn(async () => jsonResponse({ items: [{ id: 'pm_1' }] })),
    })
    expect(await withCard.hasPaymentMethod({ uid: 'owner' })).toBe(true)

    const withoutCard = createPolar({ ...config, fetchImpl: vi.fn(async () => jsonResponse({ items: [] })) })
    expect(await withoutCard.hasPaymentMethod({ uid: 'owner' })).toBe(false)
  })
})
