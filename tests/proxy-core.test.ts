// Core de cobro del proxy (E1-E3) sin emulador ni red: cuota gratuita, débito,
// libro, idempotencia, ACL, pagador por dueño (D7), admin (D11) y muro de
// storage. Es el criterio de aceptación de docs/prepaid-usage-model.md §8.
import { describe, expect, it } from 'vitest'
import {
  CREDIT_PACKS,
  FREE_QUOTA_OPS,
  PRICES,
  STORAGE_LIMIT_BYTES,
  accountState,
  chargeFor,
  dayKey,
  describeAccount,
  executeNoteOperation,
  renewalAt,
  roundUsd,
} from '../server/src/core.mjs'
import { creditTopUp, expiryFrom } from '../server/src/billing.mjs'
import { createMemoryStore } from '../server/src/memory.mjs'

const now = new Date('2026-11-23T10:00:00.000Z')
const DAY = '2026-11-23'

const block = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  jid: 1,
  hash: '0123456789ab',
  bytes: 12,
  data: 'AAECAwQFBgcICQoL',
  clientId: 42,
  ...overrides,
})

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

function seed(extra: Record<string, unknown> = {}) {
  return createMemoryStore({
    'notes/n1': noteDoc(),
    ...extra,
  })
}

const op = (store: ReturnType<typeof seed>, input: Record<string, unknown> = {}) =>
  executeNoteOperation(store, {
    senderUid: 'owner',
    noteId: 'n1',
    kind: 'block',
    opId: 'op_aaaaaaaaaaaa',
    payload: block(),
    now,
    ...input,
  })

describe('precio y cuota', () => {
  it('cobra solo la parte que cruza la cuota gratuita', () => {
    expect(chargeFor({ opsUsed: 0, writes: 1 }).costUsd).toBe(0)
    expect(chargeFor({ opsUsed: 699, writes: 1 }).costUsd).toBe(0)
    expect(chargeFor({ opsUsed: 700, writes: 1 }).costUsd).toBe(PRICES.write)
    expect(chargeFor({ opsUsed: 700, writes: 3 }).costUsd).toBe(roundUsd(3 * PRICES.write))
  })

  it('la cuota se renueva a las 00:00 UTC del día siguiente', () => {
    expect(dayKey(now)).toBe(DAY)
    expect(renewalAt(now).toISOString()).toBe('2026-11-24T00:00:00.000Z')
  })

  it('estados de la cuenta', () => {
    expect(accountState({ opsUsed: 10 })).toBe('free')
    expect(accountState({ opsUsed: 700 })).toBe('free')
    expect(accountState({ opsUsed: 701, balanceUsd: 0 })).toBe('free-exhausted')
    expect(accountState({ opsUsed: 701, balanceUsd: 0, totalToppedUpUsd: 5 })).toBe('pay-exhausted')
    expect(accountState({ opsUsed: 701, balanceUsd: 0.5, thresholdUsd: 1 })).toBe('low')
    expect(accountState({ opsUsed: 701, balanceUsd: 3, thresholdUsd: 1 })).toBe('paid')
    expect(accountState({ opsUsed: 5000, admin: true })).toBe('admin')
  })

  it('los packs y el mínimo son los del documento', () => {
    expect([...CREDIT_PACKS]).toEqual([5, 15, 50])
    expect(FREE_QUOTA_OPS).toBe(700)
    expect(STORAGE_LIMIT_BYTES).toBe(100 * 1024 * 1024)
  })
})

describe('operación dentro de la cuota', () => {
  it('escribe el bloque y no toca el saldo', async () => {
    const store = seed({ 'credits/owner': { balanceUsd: 5 } })
    const result = await op(store)

    expect(result.ok).toBe(true)
    expect(result.chargeUsd).toBe(0)
    expect(result.balanceUsd).toBe(5)
    expect(result.state).toBe('free')
    expect(result.allowance).toMatchObject({ day: DAY, opsUsed: 1, quota: 700, remaining: 699 })
    expect(store.docs.has('notes/n1/updates/op_aaaaaaaaaaaa')).toBe(true)
    expect(store.docs.get(`allowance/owner/days/${DAY}`)).toMatchObject({ opsUsed: 1 })
    // Sin débito no hay asiento: el libro solo registra plata que se movió.
    expect([...store.docs.keys()].some((path) => path.includes('/ledger/'))).toBe(false)
  })

  it('un guardado de body cuesta 3 ops y mueve el stock de storage', async () => {
    const store = seed()
    const result = await executeNoteOperation(store, {
      senderUid: 'owner',
      noteId: 'n1',
      kind: 'body',
      opId: 'op_bodyaaaaaaaa',
      payload: { markdown: 'hola mundo', title: 'T', version: 2 },
      now,
    })

    expect(result.ok).toBe(true)
    expect(result.allowance.opsUsed).toBe(3)
    expect(store.docs.get('notes/n1/body/main')).toMatchObject({ markdown: 'hola mundo' })
    expect(store.docs.get('notes/n1')).toMatchObject({ title: 'T', version: 2 })
    expect(store.docs.get('allowance/owner')).toMatchObject({ storageBytes: 10 })
  })
})

describe('idempotencia', () => {
  it('reenviar el mismo bloque no vuelve a cobrar ni a contar', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 1 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const first = await op(store)
    expect(first.ok).toBe(true)
    expect(first.idempotent).toBe(false)
    expect(first.chargeUsd).toBe(PRICES.write)

    const second = await op(store)
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.chargeUsd).toBe(0)
    expect(store.docs.get(`allowance/owner/days/${DAY}`)).toMatchObject({ opsUsed: 701 })
  })

  it('un body reintentado no duplica ni el débito ni el libro', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 1 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const input = {
      senderUid: 'owner',
      noteId: 'n1',
      kind: 'body',
      opId: 'op_bodybbbbbbbb',
      payload: { markdown: 'texto' },
      now,
    }
    const first = await executeNoteOperation(store, input)
    const second = await executeNoteOperation(store, input)

    expect(first.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.balanceUsd).toBe(first.balanceUsd)
    expect(
      [...store.docs.keys()].filter((path) => path.startsWith('credits/owner/ledger/'))
    ).toHaveLength(1)
  })
})

describe('pasada la cuota', () => {
  it('debita el saldo y escribe un asiento negativo', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 2, thresholdUsd: 1 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const result = await op(store)

    expect(result.ok).toBe(true)
    expect(result.chargeUsd).toBe(PRICES.write)
    expect(result.balanceUsd).toBe(roundUsd(2 - PRICES.write))
    expect(result.state).toBe('paid')

    const ledger = [...store.docs.entries()].filter(([path]) => path.startsWith('credits/owner/ledger/'))
    expect(ledger).toHaveLength(1)
    expect(ledger[0][1]).toMatchObject({
      kind: 'usage',
      amountUsd: -PRICES.write,
      day: DAY,
      opId: 'op_aaaaaaaaaaaa',
    })
  })

  it('sin saldo rechaza con free-exhausted y no escribe el bloque', async () => {
    const store = seed({ [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 } })
    const result = await op(store)

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ status: 402, error: 'no-funds', state: 'free-exhausted' })
    expect(store.docs.has('notes/n1/updates/op_aaaaaaaaaaaa')).toBe(false)
    expect(store.docs.get(`allowance/owner/days/${DAY}`)).toMatchObject({ opsUsed: 700 })
  })

  it('con saldo pero insuficiente rechaza con pay-exhausted y no deja saldo negativo', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 0.000001, totalToppedUpUsd: 5 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const result = await op(store)

    expect(result).toMatchObject({ ok: false, status: 402, state: 'pay-exhausted' })
    expect(store.docs.get('credits/owner')).toMatchObject({ balanceUsd: 0.000001 })
  })

  it('deja una orden de auto top-up cuando el saldo cae bajo el umbral', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 0.5, thresholdUsd: 1, topUpUsd: 15, autoTopUp: true },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const result = await op(store)

    expect(result.ok).toBe(true)
    expect(result.autoTopUp).toMatchObject({ amountUsd: 15 })
    const topup = [...store.docs.entries()].find(([path]) => path.startsWith('credits/owner/topups/'))
    expect(topup?.[1]).toMatchObject({ amountUsd: 15, status: 'pending', auto: true })
  })
})

describe('ACL y pagador', () => {
  it('un extraño no puede escribir', async () => {
    const store = seed()
    const result = await op(store, { senderUid: 'intruso' })
    expect(result).toMatchObject({ ok: false, status: 403, error: 'forbidden' })
    expect(store.docs.has('notes/n1/updates/op_aaaaaaaaaaaa')).toBe(false)
  })

  it('un viewer de link no escribe; un link-editor sí', async () => {
    const viewer = seed({ 'notes/n1': noteDoc({ access: 'link-view' }) })
    expect((await op(viewer, { senderUid: 'lector' })).status).toBe(403)

    const editor = seed({ 'notes/n1': noteDoc({ access: 'link-edit' }) })
    expect((await op(editor, { senderUid: 'lector' })).ok).toBe(true)
  })

  it('paga el dueño del documento, no quien escribe (D7)', async () => {
    const store = seed({
      'notes/n1': noteDoc({ memberIds: ['owner', 'guest'], roles: { owner: 'owner', guest: 'editor' } }),
      'credits/owner': { balanceUsd: 3, thresholdUsd: 1 },
      'credits/guest': { balanceUsd: 99 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 700 },
    })
    const result = await op(store, { senderUid: 'guest' })

    expect(result.ok).toBe(true)
    expect(store.docs.get('credits/owner')).toMatchObject({ balanceUsd: roundUsd(3 - PRICES.write) })
    expect(store.docs.get('credits/guest')).toMatchObject({ balanceUsd: 99 })
    expect(store.docs.get(`allowance/owner/days/${DAY}`)).toMatchObject({ opsUsed: 701 })
  })

  it('la carpeta manda cuando la nota hereda su ACL', async () => {
    const store = createMemoryStore({
      'notes/n1': noteDoc({ aclSource: 'folder', folderId: 'f1' }),
      'folders/f1': { ownerId: 'owner', memberIds: ['owner'], roles: { owner: 'owner' }, access: 'link-view' },
    })
    const result = await op(store, { senderUid: 'lector' })
    expect(result.status).toBe(403)
  })

  it('el admin no paga ni tiene tope (D11)', async () => {
    const store = seed({
      'admins/owner': { email: 'iuvalgoldansky@gmail.com' },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 5000 },
    })
    const result = await op(store)

    expect(result.ok).toBe(true)
    expect(result.chargeUsd).toBe(0)
    expect(result.state).toBe('admin')
    expect(store.docs.get(`allowance/owner/days/${DAY}`)).toMatchObject({ opsUsed: 5001 })
    expect([...store.docs.keys()].some((path) => path.includes('/ledger/'))).toBe(false)
  })
})

describe('validación y muro de storage', () => {
  it('un bloque mal formado no se cobra', async () => {
    const store = seed()
    const result = await op(store, { payload: block({ hash: 'ZZZ' }) })
    expect(result).toMatchObject({ ok: false, status: 400, error: 'invalid-hash' })
    expect(store.docs.has('notes/n1/updates/op_aaaaaaaaaaaa')).toBe(false)
  })

  it('rechaza la escritura que cruza los 100 MB y no borra nada', async () => {
    const store = seed({
      'allowance/owner': { storageBytes: STORAGE_LIMIT_BYTES - 4 },
    })
    const result = await executeNoteOperation(store, {
      senderUid: 'owner',
      noteId: 'n1',
      kind: 'body',
      opId: 'op_bodycccccccc',
      payload: { markdown: 'x'.repeat(10) },
      now,
    })
    expect(result).toMatchObject({ ok: false, status: 402, error: 'storage-over', state: 'storage-over' })
    expect(store.docs.get('allowance/owner')).toMatchObject({ storageBytes: STORAGE_LIMIT_BYTES - 4 })
    expect(store.docs.has('notes/n1/body/main')).toBe(false)
  })

  it('acepta la escritura que entra justo bajo el muro', async () => {
    const store = seed({ 'allowance/owner': { storageBytes: STORAGE_LIMIT_BYTES - 10 } })
    const result = await executeNoteOperation(store, {
      senderUid: 'owner',
      noteId: 'n1',
      kind: 'body',
      opId: 'op_bodydddddddd',
      payload: { markdown: 'x'.repeat(10) },
      now,
    })
    expect(result.ok).toBe(true)
    expect(store.docs.get('allowance/owner')).toMatchObject({ storageBytes: STORAGE_LIMIT_BYTES })
  })
})

describe('recargas (E6)', () => {
  it('acredita saldo, escribe el libro y vence a 24 meses', async () => {
    const store = seed()
    const result = await creditTopUp(store, {
      uid: 'owner',
      amountUsd: 15,
      eventId: 'evt_1',
      provider: 'lemonsqueezy',
      now,
    })

    expect(result).toMatchObject({ ok: true, idempotent: false, balanceUsd: 15 })
    expect(store.docs.get('credits/owner')).toMatchObject({
      balanceUsd: 15,
      totalToppedUpUsd: 15,
      expiresAt: expiryFrom(now).toISOString(),
    })
    expect(expiryFrom(now).toISOString()).toBe('2028-11-23T00:00:00.000Z')
    const ledger = [...store.docs.entries()].filter(([path]) => path.startsWith('credits/owner/ledger/'))
    expect(ledger[0][1]).toMatchObject({ kind: 'topup', amountUsd: 15, provider: 'lemonsqueezy' })
  })

  it('el mismo evento dos veces no duplica la plata', async () => {
    const store = seed()
    await creditTopUp(store, { uid: 'owner', amountUsd: 5, eventId: 'evt_2', now })
    const again = await creditTopUp(store, { uid: 'owner', amountUsd: 5, eventId: 'evt_2', now })

    expect(again.idempotent).toBe(true)
    expect(store.docs.get('credits/owner')).toMatchObject({ balanceUsd: 5, totalToppedUpUsd: 5 })
    expect(
      [...store.docs.keys()].filter((path) => path.startsWith('credits/owner/ledger/'))
    ).toHaveLength(1)
  })

  it('rechaza un monto bajo el mínimo o sin uid', async () => {
    const store = seed()
    await expect(creditTopUp(store, { uid: 'owner', amountUsd: 1, eventId: 'e', now })).rejects.toThrow(
      'amount-below-minimum'
    )
    await expect(creditTopUp(store, { uid: '', amountUsd: 5, eventId: 'e', now })).rejects.toThrow(
      'missing-uid'
    )
  })
})

describe('lectura del estado', () => {
  it('describe la cuenta sin escribir nada', async () => {
    const store = seed({
      'credits/owner': { balanceUsd: 1.25, thresholdUsd: 0.5, autoTopUp: true },
      'allowance/owner': { storageBytes: 2048 },
      [`allowance/owner/days/${DAY}`]: { day: DAY, opsUsed: 3 },
    })
    const account = await describeAccount(store, 'owner', { now })

    expect(account).toMatchObject({
      day: DAY,
      opsUsed: 3,
      remaining: 697,
      storageBytes: 2048,
      balanceUsd: 1.25,
      state: 'free',
      autoTopUp: true,
      admin: false,
    })
  })
})
