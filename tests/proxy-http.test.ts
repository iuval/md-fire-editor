// Router del proxy sobre un servidor HTTP real y un puerto efímero: auth,
// idempotencia, rechazos 402, CORS y checkout. Sin emulador ni red externa.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProxyHandler } from '../server/src/http.mjs'
import { createMemoryStore } from '../server/src/memory.mjs'

const now = new Date('2026-11-23T10:00:00.000Z')
const DAY = '2026-11-23'

const block = {
  v: 1,
  jid: 7,
  hash: '0123456789ab',
  bytes: 12,
  data: 'AAECAwQFBgcICQoL',
  clientId: 42,
}

function noteDoc(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: 'owner',
    folderId: null,
    aclSource: 'own',
    memberIds: ['owner'],
    roles: { owner: 'owner' },
    access: 'restricted',
    title: 'Nota',
    ...overrides,
  }
}

let server: http.Server
let base = ''
let store: ReturnType<typeof createMemoryStore>
let checkout: { createSession: ReturnType<typeof vi.fn>; parseWebhook: ReturnType<typeof vi.fn> }

async function start(seed: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  store = createMemoryStore({ 'notes/n1': noteDoc(), ...seed })
  checkout = {
    createSession: vi.fn(async ({ uid, packUsd }: { uid: string; packUsd: number }) => ({
      url: `https://checkout.test/${packUsd}?uid=${uid}`,
      id: 'cs_1',
    })),
    parseWebhook: vi.fn(async (raw: string) => JSON.parse(raw)),
  }
  const handler = createProxyHandler({
    store,
    verifyIdToken: async (token: string) => (token === 'good' ? { uid: 'owner', email: 'o@x' } : null),
    checkout,
    now: () => now,
    allowedOrigins: ['https://app.test'],
    logger: { error: () => undefined },
    ...options,
  })
  server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  if (!server) return
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  expect(address).not.toBeNull()
})

const post = (path: string, body: unknown, token = 'good', headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })

describe('proxy HTTP', () => {
  beforeEach(async () => {
    await start()
  })

  it('responde el health check', async () => {
    const response = await fetch(`${base}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('rechaza sin token y con token inválido', async () => {
    expect((await post('/v1/notes/n1/blocks', { opId: 'op_aaaaaaaaaaaa', block }, '')).status).toBe(401)
    expect((await post('/v1/notes/n1/blocks', { opId: 'op_aaaaaaaaaaaa', block }, 'bad')).status).toBe(401)
  })

  it('aplica un bloque y devuelve el recibo', async () => {
    const response = await post('/v1/notes/n1/blocks', { opId: 'op_aaaaaaaaaaaa', block })
    const receipt = await response.json()

    expect(response.status).toBe(200)
    expect(receipt).toMatchObject({
      ok: true,
      id: 'op_aaaaaaaaaaaa',
      idempotent: false,
      chargeUsd: 0,
      state: 'free',
    })
    expect(receipt.allowance).toMatchObject({ day: DAY, opsUsed: 1, quota: 700 })
    expect(store.docs.has('notes/n1/updates/op_aaaaaaaaaaaa')).toBe(true)
  })

  it('responde 402 con el estado cuando no hay saldo ni cuota', async () => {
    await start({ [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 } })
    const response = await post('/v1/notes/n1/blocks', { opId: 'op_bbbbbbbbbbbb', block })
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body).toMatchObject({ ok: false, error: 'no-funds', state: 'free-exhausted' })
    expect(body.allowance).toMatchObject({ day: DAY, opsUsed: 700 })
  })

  it('un payload inválido no escribe ni cobra', async () => {
    const response = await post('/v1/notes/n1/blocks', {
      opId: 'op_cccccccccccc',
      block: { ...block, hash: 'nope' },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid-hash' })
    expect(store.docs.has('notes/n1/updates/op_cccccccccccc')).toBe(false)
  })

  it('guarda el body por la misma puerta', async () => {
    const response = await post('/v1/notes/n1/body', {
      opId: 'op_bodyaaaaaaaa',
      body: { markdown: '# hola', title: 'Nueva', version: 3 },
    })
    const receipt = await response.json()

    expect(response.status).toBe(200)
    expect(receipt.allowance.opsUsed).toBe(3)
    expect(store.docs.get('notes/n1/body/main')).toMatchObject({ markdown: '# hola' })
    expect(store.docs.get('notes/n1')).toMatchObject({ title: 'Nueva' })
  })

  it('acepta el prefijo /api de la rewrite de Hosting', async () => {
    const response = await post('/api/v1/notes/n1/blocks', { opId: 'op_dddddddddddd', block })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, id: 'op_dddddddddddd' })
  })

  it('expone el estado de la cuenta', async () => {
    const response = await fetch(`${base}/v1/account`, { headers: { Authorization: 'Bearer good' } })
    const account = await response.json()

    expect(response.status).toBe(200)
    expect(account).toMatchObject({ day: DAY, opsUsed: 0, quota: 700, state: 'free', admin: false })
  })

  it('acepta cualquier monto dentro del rango, no solo los presets', async () => {
    const ok = await post('/v1/billing/checkout', { amountUsd: 20 })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ url: 'https://checkout.test/20?uid=owner', amountUsd: 20 })

    // Monto libre y decimal: los presets son de la UI.
    const custom = await post('/v1/billing/checkout', { amountUsd: 3.5 })
    expect(custom.status).toBe(200)
    expect(await custom.json()).toMatchObject({ amountUsd: 3.5 })
    expect(checkout.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'owner', packUsd: 3.5 })
    )

    // Fuera de rango no hay checkout.
    expect((await post('/v1/billing/checkout', { amountUsd: 0.5 })).status).toBe(400)
    expect((await post('/v1/billing/checkout', { amountUsd: 100.01 })).status).toBe(400)
  })

  it('acredita el saldo desde el webhook del MoR', async () => {
    const response = await post(
      '/v1/billing/webhook',
      { uid: 'owner', amountUsd: 5, eventId: 'evt_1', provider: 'lemonsqueezy' },
      ''
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, idempotent: false, balanceUsd: 5 })
    expect(store.docs.get('credits/owner')).toMatchObject({ balanceUsd: 5 })
  })

  it('agrega CORS solo para el origen permitido', async () => {
    const allowed = await fetch(`${base}/healthz`, { headers: { Origin: 'https://app.test' } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.test')

    const blocked = await fetch(`${base}/healthz`, { headers: { Origin: 'https://evil.test' } })
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('404 en rutas desconocidas', async () => {
    const response = await post('/v1/nope', {}, 'good')
    expect(response.status).toBe(404)
  })
})

describe('proxy sin checkout configurado', () => {
  it('devuelve 503 y no inventa una sesión', async () => {
    await start({}, { checkout: null })
    expect((await post('/v1/billing/checkout', { packUsd: 5 })).status).toBe(503)
  })
})

describe('compactación por HTTP', () => {
  it('acepta el manifest y borra los bloques pedidos', async () => {
    await start({
      'notes/n1/updates/b1': { v: 1, jid: 1, hash: '0123456789ab', bytes: 3, data: 'AQID', clientId: 1 },
      'notes/n1/updates/b2': { v: 1, jid: 2, hash: '0123456789ac', bytes: 3, data: 'AQID', clientId: 1 },
    })
    const response = await post('/v1/notes/n1/compact', {
      opId: 'op_compactaaaaa',
      compact: {
        blockIds: ['b1', 'b2'],
        manifest: { epoch: 1, snapshot: 'AAAA', stateVector: 'BBBB', jid: 2, bytes: 3, clientId: 1 },
      },
    })
    const receipt = await response.json()

    expect(response.status).toBe(200)
    expect(receipt.allowance).toMatchObject({ opsUsed: 3, writes: 1, deletes: 2 })
    expect(store.docs.has('notes/n1/updates/b1')).toBe(false)
    expect(store.docs.get('notes/n1/collab/manifest')).toMatchObject({ snapshot: 'AAAA' })
  })
})

describe('portal de tarjetas y recarga automática', () => {
  it('devuelve la URL del portal para guardar la tarjeta', async () => {
    const ensureCustomer = vi.fn(async () => 'cus_1')
    const createPortalSession = vi.fn(async () => ({ url: 'https://polar.sh/portal/abc', id: 'cs_1' }))
    await start({}, { checkout: { ...checkout, ensureCustomer, createPortalSession } })

    const response = await post('/v1/billing/portal', { returnUrl: 'https://app.test/ok' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ url: 'https://polar.sh/portal/abc' })
    expect(ensureCustomer).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner' }))
    expect(createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'owner', returnUrl: 'https://app.test/ok' })
    )
  })

  it('adjunta el resultado del cobro off-session a la operación que lo disparó', async () => {
    const autoTopUp = vi.fn(async () => ({ status: 'paid', orderId: 'order_1', amountUsd: 5 }))
    await start(
      {
        [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
        'credits/owner': {
          balanceUsd: 1,
          thresholdUsd: 5,
          topUpUsd: 5,
          autoTopUp: true,
          polarCustomerId: 'cus_1',
        },
      },
      { autoTopUp }
    )

    const response = await post('/v1/notes/n1/blocks', { opId: 'op_eeeeeeeeeeee', block })
    const receipt = await response.json()

    expect(response.status).toBe(200)
    expect(receipt.autoTopUp).toMatchObject({
      amountUsd: 5,
      customerId: 'cus_1',
      charge: { status: 'paid', orderId: 'order_1' },
    })
    expect(autoTopUp).toHaveBeenCalledWith({
      request: expect.objectContaining({ uid: 'owner', customerId: 'cus_1', amountUsd: 5 }),
    })
  })
})
