// Adaptador real del proxy (`server/src/firestore.mjs`) contra un Firestore de
// verdad: transacción, idempotencia, débito, libro, `DELETE_FIELD` del markdown
// y stock de storage. Corre contra el emulador porque el Admin SDK necesita un
// proyecto; con el emulador no hay credenciales de por medio.
//
//   npm run test:proxy:store      (requiere `npm --prefix server install`)
//
// No es un test de rules: el Admin SDK las saltea a propósito. Eso es
// exactamente lo que hay que probar: el proxy escribe lo que el cliente no puede.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requireServer = createRequire(resolve(__dirname, '..', 'server', 'package.json'))

let admin: {
  app: { initializeApp: Function; applicationDefault: Function; getApps: Function }
  firestore: { getFirestore: Function }
} | null = null
try {
  admin = {
    app: requireServer('firebase-admin/app'),
    firestore: requireServer('firebase-admin/firestore'),
  }
} catch {
  admin = null
}

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-firemd'

// Sin `firebase-admin` instalado el archivo se saltea entero.
const suite = admin && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

suite('store real de Firestore', () => {
  const day = new Date().toISOString().slice(0, 10)
  const uid = `smoke-${Math.random().toString(36).slice(2, 10)}`
  const noteId = `smoke-note-${Math.random().toString(36).slice(2, 10)}`
  const block = { v: 1, jid: 1, hash: '0123456789ab', bytes: 3, data: 'AQID', clientId: 1 }

  let db: any
  let store: any
  let executeNoteOperation: any

  const op = (opId: string, kind = 'block', payload: unknown = block) =>
    executeNoteOperation(store, { senderUid: uid, noteId, kind, opId, payload })

  beforeAll(async () => {
    admin!.app.initializeApp({ projectId: PROJECT, credential: admin!.app.applicationDefault() })
    db = admin!.firestore.getFirestore()
    ;({ createFirestoreStore: store } = await import('../server/src/firestore.mjs'))
    store = await store()
    ;({ executeNoteOperation } = await import('../server/src/core.mjs'))

    await db.doc(`notes/${noteId}`).set({
      ownerId: uid,
      folderId: null,
      aclSource: 'own',
      memberIds: [uid],
      roles: { [uid]: 'owner' },
      access: 'restricted',
      title: 'smoke',
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  afterAll(async () => {
    const refs: any[] = []
    for (const sub of ['updates', 'body']) {
      const snap = await db.collection(`notes/${noteId}/${sub}`).get()
      snap.docs.forEach((doc: any) => refs.push(doc.ref))
    }
    refs.push(db.doc(`notes/${noteId}`))
    for (const path of [`credits/${uid}/ledger`, `credits/${uid}/topups`, `allowance/${uid}/days`]) {
      const snap = await db.collection(path).get()
      snap.docs.forEach((doc: any) => refs.push(doc.ref))
    }
    const ops = await db.collection('proxyOps').where('noteId', '==', noteId).get()
    ops.docs.forEach((doc: any) => refs.push(doc.ref))
    refs.push(db.doc(`credits/${uid}`), db.doc(`allowance/${uid}`))
    for (const ref of refs) await ref.delete().catch(() => undefined)
  })

  it('escribe el bloque, lo cuenta y no cobra dentro de la cuota', async () => {
    const result = await op('op_a1b2c3d4')
    expect(result).toMatchObject({ ok: true, idempotent: false, chargeUsd: 0, state: 'free' })
    expect(result.allowance.opsUsed).toBe(1)

    const stored = (await db.doc(`notes/${noteId}/updates/op_a1b2c3d4`).get()).data()
    expect(stored.hash).toBe(block.hash)
    expect(typeof stored.createdAt.toDate).toBe('function')
  })

  it('el mismo opId no vuelve a contar ni a cobrar', async () => {
    const again = await op('op_a1b2c3d4')
    expect(again).toMatchObject({ ok: true, idempotent: true, chargeUsd: 0 })
    expect(again.allowance.opsUsed).toBe(1)
  })

  it('debita el saldo y escribe el asiento cuando la cuota ya está al tope', async () => {
    await db
      .doc(`allowance/${uid}/days/${day}`)
      .set({ day, opsUsed: 700, writes: 700, quota: 700 }, { merge: true })
    await db
      .doc(`credits/${uid}`)
      .set({ balanceUsd: 0.001, thresholdUsd: 0, topUpUsd: 5, autoTopUp: false }, { merge: true })

    const charged = await op('op_b1b2c3d4')
    expect(charged.chargeUsd).toBeCloseTo(0.000005, 12)

    const credits = (await db.doc(`credits/${uid}`).get()).data()
    expect(credits.balanceUsd).toBeCloseTo(0.000995, 12)
    const ledger = await db.collection(`credits/${uid}/ledger`).get()
    expect(ledger.size).toBe(1)
    expect(ledger.docs[0].data()).toMatchObject({ kind: 'usage', day })
    expect(ledger.docs[0].data().amountUsd).toBeLessThan(0)
  })

  it('guarda el body, migra el markdown fuera de la nota y mueve el stock', async () => {
    const result = await op('op_c1b2c3d4', 'body', { markdown: '# smoke\n\nhola', version: 1 })
    expect(result.ok).toBe(true)

    const body = (await db.doc(`notes/${noteId}/body/main`).get()).data()
    const note = (await db.doc(`notes/${noteId}`).get()).data()
    const allowance = (await db.doc(`allowance/${uid}`).get()).data()
    expect(body.markdown).toBe('# smoke\n\nhola')
    expect(note.markdown).toBeUndefined()
    expect(allowance.storageBytes).toBe(13)
  })

  it('sin saldo y sobre la cuota rechaza sin escribir', async () => {
    await db.doc(`credits/${uid}`).set({ balanceUsd: 0 }, { merge: true })
    const rejected = await op('op_d1b2c3d4')
    expect(rejected).toMatchObject({ ok: false, status: 402, state: 'free-exhausted' })
    expect((await db.doc(`notes/${noteId}/updates/op_d1b2c3d4`).get()).exists).toBe(false)
  })
})
