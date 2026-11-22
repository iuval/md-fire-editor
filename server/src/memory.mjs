// In-memory document store con la misma interfaz de transacción que Firestore.
// Existe para probar el core sin emulador y sin red: mismas garantías (la
// transacción ve un snapshot y solo se publica si la operación no fue rechazada).
import { randomUUID } from 'node:crypto'
import { DELETE_FIELD } from './core.mjs'

export function createMemoryStore(seed = {}) {
  const docs = new Map()
  for (const [path, data] of Object.entries(seed)) docs.set(path, structuredClone(data))

  return {
    docs,
    /** Lectura fuera de transacción (UI del saldo, health checks). */
    async readDoc(path) {
      return docs.has(path) ? structuredClone(docs.get(path)) : null
    },
    async runTransaction(fn) {
      const view = new Map([...docs].map(([path, data]) => [path, structuredClone(data)]))
      const tx = {
        async get(path) {
          return view.has(path) ? structuredClone(view.get(path)) : null
        },
        set(path, data, opts) {
          const entries = Object.entries(data).filter(([, value]) => value !== DELETE_FIELD)
          if (opts?.merge) {
            const next = { ...structuredClone(view.get(path) ?? {}) }
            for (const [key, value] of entries) next[key] = structuredClone(value)
            view.set(path, next)
            return
          }
          view.set(path, Object.fromEntries(entries.map(([key, value]) => [key, structuredClone(value)])))
        },
        delete(path) {
          view.delete(path)
        },
        newId() {
          return randomUUID()
        },
      }
      const result = await fn(tx)
      if (!result || result.ok !== false) {
        docs.clear()
        for (const [path, data] of view) docs.set(path, data)
      }
      return result
    },
  }
}
