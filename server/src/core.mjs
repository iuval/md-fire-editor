// Billing + authorization core of the FireMD proxy.
//
// Pure logic: no SDK, no HTTP, no clock of its own. Everything it needs to read
// or write goes through the transaction interface (`tx.get` / `tx.set`), so the
// same code runs against Firestore (Cloud Run) and against an in-memory store
// (tests). See docs/prepaid-usage-model.md §3.6 for the decision order.
//
// Decision order of every operation:
//   1. ACL      ¿puede este uid escribir esta nota?
//   2. Pagador  dueño del documento (D7), no el remitente
//   3. Idempotencia  ¿opId ya aplicado? → responder ok sin cobrar
//   4. Cuota    opsUsed + costo ≤ cuota gratuita → aplicar y no debitar
//   5. Saldo    balanceUsd ≥ costo → aplicar, debitar y escribir el libro
//   6. Ninguno  rechazar con un estado explícito, sin escribir nada

/** Cuota gratuita diaria de operaciones (D6). */
export const FREE_QUOTA_OPS = 700
/** Vence a las 00:00 UTC. */
export const QUOTA_PERIOD = 'UTC-day'
/** 100 MB: es un stock, no un flujo. */
export const STORAGE_LIMIT_BYTES = 100 * 1024 * 1024
export const MIN_TOP_UP_USD = 1
export const MIN_AUTO_TOP_UP_USD = 5
export const CREDIT_PACKS = [1, 5, 20]
export const CREDIT_EXPIRY_MONTHS = 24

/** Precio publicado (docs/prepaid-usage-model.md §2.1), en USD por unidad. */
export const PRICES = {
  /** $0,50 / 100k escrituras */
  write: 0.5 / 100_000,
  /** $0,10 / 100k borrados */
  delete: 0.1 / 100_000,
  /** $0,30 / 100k lecturas entregadas. No se le cobran al usuario (D9). */
  read: 0.3 / 100_000,
}

/**
 * Escrituras que consume cada tipo de operación del canal caliente. Se cobra lo
 * que el proxy escribe de verdad: un bloque es su propio registro de
 * idempotencia (1); un guardado de body escribe body + nota + recibo (3, y no
 * los 2 del cliente, que no necesita recibo).
 */
export const OP_WRITES = {
  block: 1,
  body: 3,
  // Compactar escribe el manifest; cada bloque podado es un borrado aparte.
  compact: 1,
}

const MAX_BLOCK_BYTES = 500_000
const MAX_BLOCK_CHARS = 620_000
const BLOCK_HASH = /^[0-9a-f]{12}$/
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** Sentinela para borrar un campo en un `set` con merge. */
export const DELETE_FIELD = Symbol.for('firemd.delete-field')

export const docPath = {
  note: (noteId) => `notes/${noteId}`,
  folder: (folderId) => `folders/${folderId}`,
  noteBody: (noteId) => `notes/${noteId}/body/main`,
  noteBlock: (noteId, opId) => `notes/${noteId}/updates/${opId}`,
  noteManifest: (noteId) => `notes/${noteId}/collab/manifest`,
  admin: (uid) => `admins/${uid}`,
  allowance: (uid) => `allowance/${uid}`,
  allowanceDay: (uid, day) => `allowance/${uid}/days/${day}`,
  credits: (uid) => `credits/${uid}`,
  ledger: (uid, entryId) => `credits/${uid}/ledger/${entryId}`,
  topup: (uid, id) => `credits/${uid}/topups/${id}`,
  proxyOp: (uid, opId) => `proxyOps/${uid}_${opId}`,
  payment: (provider, eventId) => `payments/${provider}_${eventId}`,
}

// ---------- tiempo y dinero ----------

/** Día calendario UTC: la cuota se renueva a las 00:00 UTC. */
export function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function renewalAt(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/** Micro-dólar es la unidad mínima: evita el drift de sumar flotantes. */
export function roundUsd(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6
}

// ---------- ACL (espejo de src/lib/acl.ts) ----------

const RANK = { owner: 3, editor: 2, viewer: 1 }

export function roleOf(acl, uid) {
  if (!acl || !uid) return null
  return acl.roles?.[uid] ?? null
}

export function canReadAcl(acl, uid) {
  if (!acl || !uid) return false
  if ((RANK[roleOf(acl, uid)] ?? 0) >= 1) return true
  return acl.access === 'link-view' || acl.access === 'link-edit'
}

export function canWriteAcl(acl, uid) {
  if (!acl || !uid) return false
  if ((RANK[roleOf(acl, uid)] ?? 0) >= 2) return true
  return acl.access === 'link-edit'
}

/**
 * ACL efectiva de una nota: la de su carpeta cuando hereda (revocar la carpeta
 * corta el acceso en el acto), la propia cuando no.
 */
export function effectiveAcl(note, folder) {
  if (note?.aclSource === 'folder' && typeof note.folderId === 'string' && folder) return folder
  return note
}

/** D7: paga el dueño del documento, no quien escribe. */
export function payerOf(note) {
  return typeof note?.ownerId === 'string' ? note.ownerId : null
}

// ---------- cuota y saldo ----------

/**
 * Parte del costo que cae fuera de la cuota gratuita. Un op que cruza el tope
 * se cobra solo por la parte que cruza.
 */
export function chargeFor({ opsUsed = 0, writes = 0, deletes = 0, quota = FREE_QUOTA_OPS } = {}) {
  const freeLeft = Math.max(0, quota - Math.max(0, opsUsed))
  const chargeableWrites = Math.max(0, Math.max(0, writes) - freeLeft)
  const chargeableDeletes = Math.max(
    0,
    Math.max(0, deletes) - Math.max(0, freeLeft - Math.max(0, writes))
  )
  const costUsd = roundUsd(
    chargeableWrites * PRICES.write + chargeableDeletes * PRICES.delete
  )
  return { chargeableWrites, chargeableDeletes, costUsd }
}

/**
 * Estado de la cuenta después de una operación. `paid` no está en la tabla del
 * documento de diseño (§4) porque ahí solo aparecen los estados que la UI
 * muestra con un aviso; se agrega para no mentir con `free` cuando ya se cobró.
 */
export function accountState({
  opsUsed = 0,
  quota = FREE_QUOTA_OPS,
  balanceUsd = 0,
  thresholdUsd = 0,
  totalToppedUpUsd = 0,
  admin = false,
} = {}) {
  if (admin) return 'admin'
  if (opsUsed <= quota) return 'free'
  if (balanceUsd <= 0) return totalToppedUpUsd > 0 ? 'pay-exhausted' : 'free-exhausted'
  if (balanceUsd < Math.max(thresholdUsd, 0.01)) return 'low'
  return 'paid'
}

export function allowanceOf(
  day,
  { opsUsed = 0, writes = 0, deletes = 0, quota = FREE_QUOTA_OPS, now = new Date() } = {}
) {
  return {
    day,
    opsUsed,
    writes,
    deletes,
    quota,
    remaining: Math.max(0, quota - opsUsed),
    renewsAt: renewalAt(now).toISOString(),
  }
}

// ---------- validación del payload ----------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Un bloque del log Yjs: mismo envoltorio que valida `firestore.rules`, pero
 * acá se valida antes de cobrar, para no debitar un mensaje que no se aplica.
 */
export function validBlock(block) {
  if (!isPlainObject(block)) return 'invalid-block'
  const { v, jid, hash, bytes, data, clientId } = block
  if (v !== 1) return 'invalid-version'
  if (!Number.isInteger(jid) || jid <= 0) return 'invalid-jid'
  if (typeof hash !== 'string' || !BLOCK_HASH.test(hash)) return 'invalid-hash'
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BLOCK_BYTES) return 'invalid-bytes'
  if (typeof data !== 'string' || !data || data.length > MAX_BLOCK_CHARS) return 'invalid-data'
  if (!Number.isInteger(clientId)) return 'invalid-client-id'
  return null
}

const DEFAULT_MAX_MARKDOWN = 250_000

export function validBody(body) {
  if (!isPlainObject(body)) return 'invalid-body'
  if (typeof body.markdown !== 'string') return 'invalid-markdown'
  const max = Number.isInteger(body.maxChars) && body.maxChars > 0 ? body.maxChars : DEFAULT_MAX_MARKDOWN
  if (body.markdown.length > max) return 'invalid-markdown-length'
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 500)) {
    return 'invalid-title'
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 30) return 'invalid-tags'
    if (body.tags.some((tag) => typeof tag !== 'string' || tag.length > 50)) return 'invalid-tags'
  }
  if (body.version !== undefined && !Number.isInteger(body.version)) return 'invalid-version'
  return null
}

const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/
/** Máximo de borrados por transacción: 400 deja lugar al manifest y al recibo. */
export const MAX_COMPACT_BLOCKS = 400

/**
 * Compactación server-side (E5): el cliente manda el snapshot ya aplicado y los
 * ids que quedaron plegados en él. Solo se borran esos ids, así que un bloque
 * escrito mientras se compactaba no se pierde nunca.
 */
export function validCompact(payload) {
  if (!isPlainObject(payload)) return 'invalid-compact'
  const ids = payload.blockIds
  if (!Array.isArray(ids) || ids.length === 0) return 'invalid-block-ids'
  if (ids.length > MAX_COMPACT_BLOCKS) return 'too-many-block-ids'
  if (ids.some((id) => typeof id !== 'string' || !DOC_ID.test(id))) return 'invalid-block-id'
  const m = payload.manifest
  if (!isPlainObject(m)) return 'invalid-manifest'
  if (m.epoch !== 1) return 'invalid-epoch'
  if (typeof m.snapshot !== 'string' || !m.snapshot || m.snapshot.length > 900_000) {
    return 'invalid-snapshot'
  }
  if (typeof m.stateVector !== 'string' || !m.stateVector || m.stateVector.length > 4096) {
    return 'invalid-state-vector'
  }
  if (!Number.isInteger(m.jid) || m.jid < 0) return 'invalid-jid'
  if (!Number.isInteger(m.bytes) || m.bytes < 0) return 'invalid-bytes'
  if (!Number.isInteger(m.clientId)) return 'invalid-client-id'
  return null
}

function byteLength(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8')
}

function failure(status, error, extra) {
  return { ok: false, status, error, ...extra }
}

async function isAdminUid(tx, uid) {
  if (!uid) return false
  return (await tx.get(docPath.admin(uid))) != null
}

// ---------- la operación ----------

/**
 * Ejecuta (y cobra) una operación sobre una nota, dentro de una única
 * transacción: si el cobro se rechaza, la escritura no ocurre.
 */
export async function executeNoteOperation(store, input) {
  const {
    senderUid,
    noteId,
    kind,
    opId,
    payload = {},
    now = new Date(),
    quota = FREE_QUOTA_OPS,
  } = input ?? {}

  if (!senderUid) return failure(401, 'unauthenticated')
  if (typeof noteId !== 'string' || !noteId) return failure(400, 'missing-note')
  if (!(kind in OP_WRITES)) return failure(400, 'unknown-kind')
  if (typeof opId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(opId)) {
    return failure(400, 'invalid-op-id')
  }
  const invalid =
    kind === 'block' ? validBlock(payload) : kind === 'body' ? validBody(payload) : validCompact(payload)
  if (invalid) return failure(400, invalid)

  const day = dayKey(now)
  if (!DAY.test(day)) return failure(500, 'invalid-day')

  return store.runTransaction(async (tx) => {
    const note = await tx.get(docPath.note(noteId))
    if (!note) return failure(404, 'note-not-found')

    const folder =
      note.aclSource === 'folder' && typeof note.folderId === 'string'
        ? await tx.get(docPath.folder(note.folderId))
        : null
    const acl = effectiveAcl(note, folder)
    if (!canWriteAcl(acl, senderUid)) return failure(403, 'forbidden')

    const payerUid = payerOf(note)
    if (!payerUid) return failure(409, 'note-without-owner')

    // 3. Idempotencia. Un bloque usa su opId como id del documento: si ya está,
    // el mensaje se reenvió y no se vuelve a cobrar.
    const blockPath = docPath.noteBlock(noteId, opId)
    const opPath = docPath.proxyOp(senderUid, opId)
    const previous = kind === 'block' ? await tx.get(blockPath) : await tx.get(opPath)
    if (previous) {
      const allowanceDay = await tx.get(docPath.allowanceDay(payerUid, day))
      const credits = (await tx.get(docPath.credits(payerUid))) ?? {}
      const admin = await isAdminUid(tx, senderUid)
      return {
        ok: true,
        id: opId,
        kind,
        idempotent: true,
        chargeUsd: 0,
        balanceUsd: roundUsd(credits.balanceUsd ?? 0),
        state: accountState({
          opsUsed: allowanceDay?.opsUsed ?? 0,
          quota,
          balanceUsd: credits.balanceUsd ?? 0,
          thresholdUsd: credits.thresholdUsd ?? 0,
          totalToppedUpUsd: credits.totalToppedUpUsd ?? 0,
          admin,
        }),
        allowance: allowanceOf(day, { opsUsed: allowanceDay?.opsUsed ?? 0, quota, now }),
      }
    }

    const admin =
      (await isAdminUid(tx, senderUid)) || (await isAdminUid(tx, payerUid))

    // Muro de almacenamiento: se rechaza la escritura que cruza, nunca se borra.
    let storageNow = 0
    let storageDelta = 0
    if (kind === 'body') {
      const previousBody = await tx.get(docPath.noteBody(noteId))
      const previousMarkdown = previousBody?.markdown ?? note.markdown ?? ''
      storageDelta =
        byteLength(payload.markdown) - byteLength(typeof previousMarkdown === 'string' ? previousMarkdown : '')
      const allowance = (await tx.get(docPath.allowance(payerUid))) ?? {}
      storageNow = Math.max(0, Number(allowance.storageBytes ?? 0))
      if (!admin && storageNow + storageDelta > STORAGE_LIMIT_BYTES) {
        return failure(402, 'storage-over', {
          state: 'storage-over',
          storageBytes: storageNow,
          storageLimit: STORAGE_LIMIT_BYTES,
        })
      }
    }

    // 4-5. Cuota y saldo.
    const writes = OP_WRITES[kind]
    const deletes = kind === 'compact' ? payload.blockIds.length : 0
    const allowanceDay = await tx.get(docPath.allowanceDay(payerUid, day))
    const opsUsedBefore = Math.max(0, Number(allowanceDay?.opsUsed ?? 0))
    const credits = (await tx.get(docPath.credits(payerUid))) ?? {}
    const balanceBefore = Math.max(0, Number(credits.balanceUsd ?? 0))
    const charge = admin
      ? { chargeableWrites: 0, chargeableDeletes: 0, costUsd: 0 }
      : chargeFor({ opsUsed: opsUsedBefore, writes, deletes, quota })

    if (charge.costUsd > 0 && balanceBefore < charge.costUsd) {
      const state = balanceBefore <= 0
        ? (Number(credits.totalToppedUpUsd ?? 0) > 0 ? 'pay-exhausted' : 'free-exhausted')
        : 'pay-exhausted'
      return failure(402, 'no-funds', {
        state,
        balanceUsd: roundUsd(balanceBefore),
        neededUsd: charge.costUsd,
        allowance: allowanceOf(day, { opsUsed: opsUsedBefore, quota, now }),
      })
    }

    // La escritura y el cobro van en el mismo commit: no hay camino donde uno
    // ocurra sin el otro.
    if (kind === 'block') {
      tx.set(blockPath, {
        v: 1,
        jid: payload.jid,
        hash: payload.hash,
        bytes: payload.bytes,
        data: payload.data,
        clientId: payload.clientId,
        createdAt: now,
      })
    } else if (kind === 'compact') {
      tx.set(docPath.noteManifest(noteId), {
        epoch: payload.manifest.epoch,
        snapshot: payload.manifest.snapshot,
        stateVector: payload.manifest.stateVector,
        jid: payload.manifest.jid,
        bytes: payload.manifest.bytes,
        clientId: payload.manifest.clientId,
        updatedAt: now,
      })
      for (const id of payload.blockIds) tx.delete(docPath.noteBlock(noteId, id))
    } else {
      const metadata = {
        markdownBytes: payload.markdown.length,
        updatedAt: now,
        markdown: DELETE_FIELD,
      }
      if (payload.title !== undefined) metadata.title = payload.title
      if (payload.tags !== undefined) metadata.tags = payload.tags
      if (payload.version !== undefined) metadata.version = payload.version
      tx.set(
        docPath.noteBody(noteId),
        {
          markdown: payload.markdown,
          chars: payload.markdown.length,
          version: payload.version ?? 0,
          updatedAt: now,
        },
        { merge: true }
      )
      tx.set(docPath.note(noteId), metadata, { merge: true })
      tx.set(docPath.allowance(payerUid), { storageBytes: storageNow + storageDelta }, { merge: true })
    }

    const opsUsed = opsUsedBefore + writes + deletes
    const writesTotal = Math.max(0, Number(allowanceDay?.writes ?? opsUsedBefore)) + writes
    const deletesTotal = Math.max(0, Number(allowanceDay?.deletes ?? 0)) + deletes
    tx.set(
      docPath.allowanceDay(payerUid, day),
      {
        day,
        opsUsed,
        writes: writesTotal,
        deletes: deletesTotal,
        quota,
        renewsAt: renewalAt(now).toISOString(),
        updatedAt: now.toISOString(),
      },
      { merge: true }
    )

    const balanceUsd = admin ? roundUsd(balanceBefore) : roundUsd(balanceBefore - charge.costUsd)
    if (!admin) {
      tx.set(docPath.credits(payerUid), { balanceUsd, updatedAt: now }, { merge: true })
      if (charge.costUsd > 0) {
        tx.set(docPath.ledger(payerUid, tx.newId()), {
          kind: 'usage',
          amountUsd: -charge.costUsd,
          opId,
          noteId,
          opKind: kind,
          ops: writes,
          day,
          at: now.toISOString(),
        })
      }
    }

    // 6. Auto top-up: el proxy deja la orden; el cobro real lo hace el MoR (E6).
    let autoTopUp = null
    if (!admin && credits.autoTopUp && balanceUsd < Math.max(0, Number(credits.thresholdUsd ?? 0))) {
      // Recarga desatendida: piso propio, más alto que el pack más barato.
      const amountUsd = Math.max(
        MIN_AUTO_TOP_UP_USD,
        Number(credits.topUpUsd ?? MIN_AUTO_TOP_UP_USD)
      )
      const id = tx.newId()
      tx.set(docPath.topup(payerUid, id), {
        amountUsd,
        status: 'pending',
        auto: true,
        requestedAt: now,
      })
      autoTopUp = { id, amountUsd }
    }

    // El bloque ya es su propio registro de idempotencia; solo los kinds que
    // no dejan un documento con el opId necesitan el recibo aparte.
    if (kind !== 'block') {
      tx.set(opPath, {
        noteId,
        kind,
        id: opId,
        ops: writes,
        chargeUsd: charge.costUsd,
        at: now.toISOString(),
      })
    }

    return {
      ok: true,
      id: opId,
      kind,
      idempotent: false,
      chargeUsd: charge.costUsd,
      balanceUsd,
      state: accountState({
        opsUsed,
        quota,
        balanceUsd,
        thresholdUsd: credits.thresholdUsd ?? 0,
        totalToppedUpUsd: credits.totalToppedUpUsd ?? 0,
        admin,
      }),
      allowance: allowanceOf(day, {
        opsUsed,
        writes: writesTotal,
        deletes: deletesTotal,
        quota,
        now,
      }),
      ...(autoTopUp ? { autoTopUp } : {}),
    }
  })
}

/** Lo que se muestra en la UI: cuota del día, saldo y estado, sin escribir nada. */
export async function describeAccount(store, uid, { now = new Date(), quota = FREE_QUOTA_OPS } = {}) {
  const day = dayKey(now)
  const [dayDoc, credits, allowance, adminDoc] = await Promise.all([
    store.readDoc(docPath.allowanceDay(uid, day)),
    store.readDoc(docPath.credits(uid)),
    store.readDoc(docPath.allowance(uid)),
    store.readDoc(docPath.admin(uid)),
  ])
  const opsUsed = Math.max(0, Number(dayDoc?.opsUsed ?? 0))
  const balanceUsd = roundUsd(credits?.balanceUsd ?? 0)
  return {
    day,
    opsUsed,
    writes: Math.max(0, Number(dayDoc?.writes ?? opsUsed)),
    deletes: Math.max(0, Number(dayDoc?.deletes ?? 0)),
    quota,
    remaining: Math.max(0, quota - opsUsed),
    renewsAt: renewalAt(now).toISOString(),
    storageBytes: Math.max(0, Number(allowance?.storageBytes ?? 0)),
    storageLimit: STORAGE_LIMIT_BYTES,
    balanceUsd,
    thresholdUsd: Number(credits?.thresholdUsd ?? 0),
    autoTopUp: Boolean(credits?.autoTopUp),
    admin: adminDoc != null,
    state: accountState({
      opsUsed,
      quota,
      balanceUsd,
      thresholdUsd: credits?.thresholdUsd ?? 0,
      totalToppedUpUsd: credits?.totalToppedUpUsd ?? 0,
      admin: adminDoc != null,
    }),
  }
}
