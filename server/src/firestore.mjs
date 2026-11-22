// Store real: Firestore con service account (Cloud Run). `firebase-admin` se
// importa en dinámico para que el core y los tests corran sin SDK ni red.
import { DELETE_FIELD } from './core.mjs'

let cached = null

async function adminSdk() {
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app')
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore')
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      ...(process.env.GOOGLE_CLOUD_PROJECT ? { projectId: process.env.GOOGLE_CLOUD_PROJECT } : {}),
    })
  }
  return { db: getFirestore(), FieldValue }
}

function toFirestore(value, FieldValue) {
  if (value === DELETE_FIELD) return FieldValue.delete()
  if (Array.isArray(value)) return value.map((item) => toFirestore(item, FieldValue))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toFirestore(item, FieldValue)])
    )
  }
  return value
}

export async function createFirestoreStore() {
  if (cached) return cached
  const { db, FieldValue } = await adminSdk()

  cached = {
    async readDoc(path) {
      const snap = await db.doc(path).get()
      return snap.exists ? snap.data() : null
    },

    async runTransaction(fn) {
      return db.runTransaction(async (t) =>
        fn({
          async get(path) {
            const snap = await t.get(db.doc(path))
            return snap.exists ? snap.data() : null
          },
          set(path, data, opts) {
            const payload = toFirestore(data, FieldValue)
            // `DELETE_FIELD` solo aparece en writes con merge (migrar el body).
            t.set(db.doc(path), payload, opts?.merge ? { merge: true } : {})
          },
          delete(path) {
            t.delete(db.doc(path))
          },
          newId() {
            return db.collection('_ids').doc().id
          },
        })
      )
    },
  }
  return cached
}
