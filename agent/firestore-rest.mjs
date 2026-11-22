// Minimal Firestore REST client authenticated with a Firebase ID token.
//
// The Admin SDK bypasses security rules; this does not. Requests carry the
// agent's own identity, so the rules decide what the agent can touch. REST also
// avoids pulling the whole web SDK into the CLI.

import { createBudget, envLimit } from './rate-limit.mjs'

const DEFAULT_PROJECT = 'md-sync-app'

function emptyUsage() {
  return { reads: 0, writes: 0, deletes: 0, bytesRead: 0, bytesWritten: 0, agentOps: 0 }
}

/** Espejo de FREE_TIER.opsPerDay en src/lib/quota.ts. */
export const AGENT_OPS_PER_DAY = 700

function base(projectId) {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  const prefix = host ? `http://${host}/v1` : 'https://firestore.googleapis.com/v1'
  return `${prefix}/projects/${projectId}/databases/(default)/documents`
}

// ---------- value codec ----------

export function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  return { mapValue: { fields: toFields(value) } }
}

export function toFields(object) {
  const fields = {}
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue
    fields[key] = toValue(value)
  }
  return fields
}

export function fromValue(value) {
  if (!value) return null
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('timestampValue' in value) return new Date(value.timestampValue)
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromValue)
  if ('mapValue' in value) return fromFields(value.mapValue.fields ?? {})
  return null
}

export function fromFields(fields = {}) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) out[key] = fromValue(value)
  return out
}

function docFrom(response) {
  if (!response?.name) return null
  const id = response.name.split('/').pop()
  return { id, name: response.name, updateTime: response.updateTime, data: fromFields(response.fields) }
}

// ---------- client ----------

export class RestStore {
  constructor({ projectId = process.env.FIREMD_PROJECT || DEFAULT_PROJECT, token }) {
    this.projectId = projectId
    this.token = token
    this.root = base(projectId)
    this.prefix = `projects/${projectId}/databases/(default)/documents`
    // Cortacircuitos por corrida: un bucle infinito de un agente se corta acá
    // en vez de quemar el saldo. El MCP resetea el presupuesto por tool call.
    this.budget = createBudget({ limit: envLimit('FIREMD_REQUEST_BUDGET', 2000) })
    // Operaciones de esta sesión, para el bucket `usage/{uid}`. Se acumulan acá
    // y se vuelcan con `flushUsage()`; el volcado no se cuenta a sí mismo.
    this.usage = emptyUsage()
    this.metering = true
  }

  /** El MCP mide una operación por tool call; la CLI, una por comando. */
  resetBudget() {
    this.budget.reset()
  }

  /** Olvida las operaciones acumuladas (tests y sesiones nuevas). */
  resetUsage() {
    this.usage = emptyUsage()
  }

  /** Una tool call o un comando cuentan como una operación de agente. */
  meterAgentOp() {
    this.usage.agentOps += 1
  }

  /** ¿La cuenta es admin? Los admins no pagan ni tienen tope. Caché de un minuto. */
  async isAdmin() {
    const now = Date.now()
    if (this.adminCache && now - this.adminCache.at < 60_000) return this.adminCache.value
    const uid = this.uid
    let value = false
    if (uid && typeof uid === 'string') {
      try {
        value = Boolean(await this.get('admins', uid))
      } catch {
        value = false
      }
    }
    this.adminCache = { at: now, value }
    return value
  }

  /** Operaciones de agente del día en curso, con caché de un minuto. */
  async agentOpsUsed() {
    const now = Date.now()
    if (this.quotaCache && now - this.quotaCache.at < 60_000) return this.quotaCache.ops
    const uid = this.uid
    if (!uid || typeof uid !== 'string') return 0
    const day = new Date().toISOString().slice(0, 10)
    try {
      const doc = await this.get(`usage/${uid}/days`, day)
      const ops = Number(doc?.data?.agentOps ?? 0)
      this.quotaCache = { at: now, ops }
      return ops
    } catch {
      return 0
    }
  }

  async request(url, options = {}) {
    // El volcado del medidor no pasa por el presupuesto: es la contabilidad de
    // lo ya hecho, no una operación nueva del agente.
    if (this.metering) this.budget.charge()
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    if (response.status === 404) return null
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.error?.status || `HTTP ${response.status}`
      const error = new Error(message)
      error.status = response.status
      error.code = data?.error?.status
      throw error
    }
    if (this.metering) {
      this.countRequest({ method: options.method ?? 'GET', url, body: options.body, text, data })
    }
    return data
  }

  /** Suma lo que esta request consumió, con la misma vara que Firestore. */
  countRequest({ method, url, body, text, data }) {
    const usage = this.usage
    const bytes = text ? text.length : 0

    if (method === 'DELETE') {
      usage.deletes += 1
      return
    }

    if (url.includes(':commit')) {
      let writes = []
      try {
        writes = JSON.parse(body)?.writes ?? []
      } catch {
        writes = []
      }
      usage.writes += writes.length
      usage.deletes += writes.filter((write) => write?.delete).length
      usage.bytesWritten += bytes
      return
    }

    if (url.includes(':runQuery')) {
      const rows = Array.isArray(data) ? data.filter((row) => row?.document).length : 0
      usage.reads += Math.max(1, rows)
      usage.bytesRead += bytes
      return
    }

    const documents = Array.isArray(data?.documents) ? data.documents.length : 0
    usage.reads += Math.max(1, documents)
    usage.bytesRead += bytes
  }

  /**
   * Vuelca las operaciones acumuladas al bucket diario del usuario autenticado.
   * Best-effort: un fallo del contador nunca rompe el comando. Devuelve el
   * snapshot volcado, o null si no había nada que contar.
   */
  async flushUsage() {
    const uid = this.uid
    const usage = this.usage
    const total = usage.reads + usage.writes + usage.deletes + usage.agentOps
    if (!uid || typeof uid !== 'string' || total === 0) return null

    const day = new Date().toISOString().slice(0, 10)
    const snapshot = { ...usage }
    this.usage = emptyUsage()

    const transforms = []
    for (const [field, value] of Object.entries(snapshot)) {
      if (value > 0) transforms.push({ fieldPath: field, increment: value })
    }

    this.metering = false
    try {
      await this.commitWrites([
        {
          update: {
            name: `${this.prefix}/usage/${uid}/days/${day}`,
            fields: toFields({ day }),
          },
          updateMask: { fieldPaths: ['day'] },
          updateTransforms: [
            ...transforms.map((transform) => ({
              fieldPath: transform.fieldPath,
              increment: { integerValue: String(transform.increment) },
            })),
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
      ])
      return snapshot
    } catch {
      // Se descarta el snapshot: duplicar es peor que subcontar, y el medidor
      // nunca debe hacer fallar una operación del agente.
      return null
    } finally {
      this.metering = true
    }
  }

  async get(collection, id) {
    const doc = await this.request(`${this.root}/${collection}/${id}`)
    return docFrom(doc)
  }

  /** Field-masked listing: returns ids (+ requested fields) without full bodies. */
  async list(collection, { limit = 300, fields = ['title'] } = {}) {
    const params = new URLSearchParams({ pageSize: String(Math.min(limit, 300)) })
    for (const field of fields) params.append('mask.fieldPaths', field)
    const data = await this.request(`${this.root}/${collection}?${params}`)
    return (data?.documents ?? []).map(docFrom)
  }

  async query(collection, structuredQuery) {
    const data = await this.request(`${this.root}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], ...structuredQuery } }),
    })
    if (!Array.isArray(data)) return []
    return data.filter((row) => row.document).map((row) => docFrom(row.document))
  }

  /** One write, as Firestore's `:commit` expects it. */
  buildWrite({ collection, id, fields, transforms = [], updateTime, exists }) {
    const write = {
      update: { name: `${this.prefix}/${collection}/${id}`, fields: toFields(fields) },
      updateMask: { fieldPaths: Object.keys(fields) },
    }
    if (transforms.length) {
      write.updateTransforms = transforms.map((transform) =>
        transform.increment !== undefined
          ? { fieldPath: transform.fieldPath, increment: { integerValue: String(transform.increment) } }
          : { fieldPath: transform.fieldPath, setToServerValue: 'REQUEST_TIME' }
      )
    }
    if (updateTime) write.currentDocument = { updateTime }
    if (exists === false) write.currentDocument = { exists: false }
    return write
  }

  /** Several writes in one atomic commit (a note and its body, for instance). */
  async commitWrites(writes) {
    if (writes.length === 0) return
    await this.request(`${this.root}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: writes.map((write) => (write.update ? write : this.buildWrite(write))) }),
    })
  }

  async patch(collection, id, fields, options = {}) {
    await this.commitWrites([this.buildWrite({ collection, id, fields, ...options })])
  }

  /** Patches several documents in one commit. */
  async patchMany(entries) {
    await this.commitWrites(entries.map((entry) => this.buildWrite(entry)))
  }

  async create(collection, id, fields, options = {}) {
    await this.commitWrites([this.buildWrite({ collection, id, fields, ...options, exists: false })])
  }

  /** Creates several documents in one commit. */
  async createMany(entries) {
    await this.commitWrites(entries.map((entry) => this.buildWrite({ ...entry, exists: false })))
  }

  async remove(collection, id) {
    await this.request(`${this.root}/${collection}/${id}`, { method: 'DELETE' })
  }

  /** Random document id (client-side, like the web SDK does). */
  newId() {
    return Array.from({ length: 20 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 58)]
    ).join('')
  }
}
