// Minimal Firestore REST client authenticated with a Firebase ID token.
//
// The Admin SDK bypasses security rules; this does not. Requests carry the
// agent's own identity, so the rules decide what the agent can touch. REST also
// avoids pulling the whole web SDK into the CLI.

const DEFAULT_PROJECT = 'md-sync-app'

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
  constructor({ projectId = process.env.MDFIRE_PROJECT || DEFAULT_PROJECT, token }) {
    this.projectId = projectId
    this.token = token
    this.root = base(projectId)
    this.prefix = `projects/${projectId}/databases/(default)/documents`
  }

  async request(url, options = {}) {
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
    return data
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
