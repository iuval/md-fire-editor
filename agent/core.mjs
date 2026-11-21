// Agent-facing core: token-lean note access, authenticated as the agent's own
// Firebase user (an anonymous account paired from the web app).
//
// Every call goes through security rules, exactly like a person's session: a
// viewer can read, an editor can write, and removing the agent from the folder
// revokes it immediately.
//
// Response shapes are chosen for token cost:
//   - listings are TSV with short ids, never JSON
//   - reads return raw markdown plus a separate etag
//   - writes replace exact substrings and return only the delta

import { createHash } from 'node:crypto'
import { currentUid, idToken, readCredentials } from './auth.mjs'
import { RestStore } from './firestore-rest.mjs'

export class AgentError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

let cache = null

/** Opens (and memoizes) a rules-bound store for the current agent identity. */
export async function openStore() {
  const token = await idToken()
  const creds = await readCredentials()
  const projectId = process.env.MDFIRE_PROJECT || creds?.projectId || 'md-sync-app'
  if (!cache || cache.token !== token || cache.projectId !== projectId) {
    cache = new RestStore({ projectId, token })
    cache.token = token
    cache.projectId = projectId
    cache.uid = await currentUid()
  }
  return cache
}

export function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function etagOf(data) {
  return `${data.version ?? 0}-${hash(String(data.markdown ?? ''))}`
}

// --- tags (mirrors src/lib/tags.ts; the CLI must keep the denormalized field
// in sync because the app filters on it without downloading note bodies) ---

const MAX_TAGS = 30
const MAX_TAG_LENGTH = 50
const FENCED_CODE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm
const INLINE_CODE = /`[^`\n]*`/g
const INLINE_TAG = /(^|[\s([{,;:'"])#([\p{L}\p{N}_/-]+)/gu

function normalizeTag(raw) {
  const clean = String(raw)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
  return !clean || clean.length > MAX_TAG_LENGTH ? null : clean
}

export function extractTags(markdown) {
  if (!markdown) return []
  const withoutCode = String(markdown).replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ')
  const found = new Set()

  if (String(markdown).startsWith('---')) {
    const end = String(markdown).indexOf('\n---', 3)
    if (end !== -1) {
      const block = String(markdown).slice(3, end)
      const inline = block.match(/^tags:\s*\[(.*?)\]\s*$/m)
      if (inline) {
        inline[1].split(',').forEach((tag) => {
          const normalized = normalizeTag(tag)
          if (normalized) found.add(normalized)
        })
      } else {
        const list = block.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)
        if (list) {
          list[1].split('\n').forEach((line) => {
            const normalized = normalizeTag(line.replace(/^[ \t]*-[ \t]*/, ''))
            if (normalized) found.add(normalized)
          })
        }
      }
    }
  }

  for (const match of withoutCode.matchAll(INLINE_TAG)) {
    const normalized = normalizeTag(match[2])
    if (normalized) found.add(normalized)
  }

  return Array.from(found).sort().slice(0, MAX_TAGS)
}

export function shortId(id) {
  return id.slice(0, 8)
}

/** Rules only allow listing documents the caller is a member of, and they can
 * only prove that from an `array-contains` constraint. Every list query needs it. */
function memberFilter(db) {
  return {
    compositeFilter: {
      op: 'AND',
      filters: [fieldFilter('memberIds', 'ARRAY_CONTAINS', { stringValue: db.uid })],
    },
  }
}

function stamp(ts) {
  if (!ts) return '-'
  const date = ts instanceof Date ? ts : new Date(ts)
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString().slice(0, 10)
}

function uniquePrefixMatch(docs, ref, label) {
  const prefix = ref.slice(0, 8)
  const matches = docs.filter((doc) => doc.id.startsWith(prefix))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new AgentError(`no encontré la ${label} ${ref}`, 'E_NOT_FOUND')
  throw new AgentError(`${label} ambigua ${ref}: ${matches.map((m) => shortId(m.id)).join(', ')}`, 'E_AMBIGUOUS')
}

export async function resolveNote(db, ref) {
  if (!ref) throw new AgentError('falta el id de la nota', 'E_USAGE')
  // A 403 here means "not found, or not yours": either way fall through to the
  // prefix search, which never leaks whether somebody else's note exists.
  const direct = await db.get('notes', ref).catch(() => null)
  if (direct) return direct
  const docs = await db.query('notes', {
    where: memberFilter(db),
    select: { fields: [{ fieldPath: 'title' }, { fieldPath: 'memberIds' }] },
    limit: 300,
  })
  // The list is projected (cheap); fetch the full document once we know the id.
  const match = uniquePrefixMatch(docs, ref, 'nota')
  return db.get('notes', match.id)
}

export async function resolveFolder(db, ref) {
  if (!ref) throw new AgentError('falta la carpeta', 'E_USAGE')
  const direct = await db.get('folders', ref).catch(() => null)
  if (direct) return direct
  const docs = await db.query('folders', {
    where: memberFilter(db),
    select: { fields: [{ fieldPath: 'name' }, { fieldPath: 'memberIds' }] },
    limit: 300,
  })
  const wanted = String(ref).toLowerCase()
  const matches = docs.filter(
    (doc) => doc.id.startsWith(wanted) || String(doc.data.name ?? '').toLowerCase() === wanted
  )
  if (matches.length === 1) return db.get('folders', matches[0].id)
  if (matches.length === 0) throw new AgentError(`no encontré la carpeta ${ref}`, 'E_NOT_FOUND')
  throw new AgentError(`carpeta ambigua ${ref}`, 'E_AMBIGUOUS')
}

/**
 * `id  title  updated  folder` — one line per note, no bodies.
 *
 * The membership filter is mandatory: rules only allow listing docs the caller
 * is a member of, and they can only prove it from an `array-contains` query.
 * Folder filtering happens in memory to avoid an extra composite index.
 */
export async function listNotes(db, { folder, limit = 50 } = {}) {
  if (!db.uid) throw new AgentError('no se pudo determinar la identidad del agente', 'E_USAGE')

  const docs = await db.query('notes', {
    where: memberFilter(db),
    orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
    select: {
      fields: [
        { fieldPath: 'title' },
        { fieldPath: 'updatedAt' },
        { fieldPath: 'folderId' },
        { fieldPath: 'tags' },
        { fieldPath: 'memberIds' },
      ],
    },
    limit: 200,
  })

  const wanted = folder === 'root' ? null : folder ? (await resolveFolder(db, folder)).id : undefined
  const filtered =
    wanted === undefined
      ? docs
      : docs.filter((doc) => (wanted === null ? !doc.data.folderId : doc.data.folderId === wanted))

  const limited = filtered.slice(0, Math.min(Number(limit) || 50, 200))
  if (limited.length === 0) return ''
  const folders = await folderNames(db)
  return limited
    .map((doc) => {
      const folderName = doc.data.folderId ? (folders.get(doc.data.folderId) ?? shortId(doc.data.folderId)) : '-'
      return `${shortId(doc.id)}\t${String(doc.data.title || 'Sin título').replace(/\s+/g, ' ')}\t${stamp(doc.data.updatedAt)}\t${folderName}`
    })
    .join('\n')
}

function fieldFilter(fieldPath, op, value) {
  return { fieldFilter: { field: { fieldPath }, op, value } }
}

export async function folderNames(db) {
  const docs = await db.query('folders', {
    where: memberFilter(db),
    select: { fields: [{ fieldPath: 'name' }, { fieldPath: 'memberIds' }] },
    limit: 300,
  })
  const map = new Map()
  docs.forEach((doc) => map.set(doc.id, doc.data.name || 'Carpeta'))
  return map
}

export async function listFolders(db) {
  const docs = await db.query('folders', {
    where: memberFilter(db),
    orderBy: [{ field: { fieldPath: 'name' }, direction: 'ASCENDING' }],
    select: { fields: [{ fieldPath: 'name' }, { fieldPath: 'memberIds' }] },
    limit: 200,
  })
  if (docs.length === 0) return ''
  return docs.map((doc) => `${shortId(doc.id)}\t${doc.data.name || 'Carpeta'}`).join('\n')
}

/** Raw markdown only; the etag is returned separately so it never pollutes the body. */
export async function readNote(db, ref, { maxBytes = 0 } = {}) {
  const doc = await resolveNote(db, ref)
  let body = String(doc.data.markdown ?? '')
  let truncated = false
  if (maxBytes && body.length > maxBytes) {
    body = `${body.slice(0, maxBytes)}\n…[truncado ${body.length - maxBytes} bytes]`
    truncated = true
  }
  return { id: doc.id, title: doc.data.title ?? '', body, etag: etagOf(doc.data), truncated }
}

/** Exact-substring edits; returns byte deltas instead of the new document. */
export async function patchNote(db, ref, edits, { etag, replaceAll = false } = {}) {
  if (!Array.isArray(edits) || edits.length === 0) throw new AgentError('no hay ediciones', 'E_USAGE')

  const doc = await resolveNote(db, ref)
  const current = String(doc.data.markdown ?? '')

  if (etag && etag !== etagOf(doc.data)) {
    throw new AgentError(`etag desactualizado (actual ${etagOf(doc.data)})`, 'E_ETAG')
  }

  let next = current
  const applied = []
  for (const edit of edits) {
    const find = String(edit.find ?? '')
    const replace = String(edit.replace ?? '')
    if (!find) throw new AgentError('edición sin "find"', 'E_USAGE')

    const first = next.indexOf(find)
    if (first === -1) throw new AgentError(`no encontré: ${JSON.stringify(find.slice(0, 60))}`, 'E_NO_MATCH')

    if (replaceAll) {
      next = next.split(find).join(replace)
    } else {
      const second = next.indexOf(find, first + find.length)
      if (second !== -1) {
        throw new AgentError(
          `"find" aparece más de una vez: ${JSON.stringify(find.slice(0, 60))} (agregá contexto)`,
          'E_AMBIGUOUS'
        )
      }
      next = next.slice(0, first) + replace + next.slice(first + find.length)
    }
    applied.push({ find: find.slice(0, 40), delta: replace.length - find.length })
  }

  try {
    await db.patch(
      'notes',
      doc.id,
      { markdown: next, tags: extractTags(next) },
      {
        // Compare-and-swap on the read revision: a concurrent edit fails here
        // instead of silently overwriting.
        updateTime: doc.updateTime,
        transforms: [{ fieldPath: 'version', increment: 1 }, { fieldPath: 'updatedAt' }],
      }
    )
  } catch (error) {
    if (error.status === 400 || error.code === 'FAILED_PRECONDITION') {
      throw new AgentError('la nota cambió mientras editabas (reintentá con un etag nuevo)', 'E_ETAG')
    }
    throw error
  }

  return {
    id: doc.id,
    etag: etagOf({ markdown: next, version: (doc.data.version ?? 0) + 1 }),
    delta: next.length - current.length,
    edits: applied.length,
  }
}

/**
 * Replaces the whole body (disk → cloud). Used by `vault push`: the etag makes
 * a stale local copy fail instead of overwriting somebody else's edit.
 */
export async function replaceNote(db, ref, markdown, { etag } = {}) {
  const doc = await resolveNote(db, ref)
  if (etag && etag !== etagOf(doc.data)) {
    throw new AgentError(`etag desactualizado (actual ${etagOf(doc.data)})`, 'E_ETAG')
  }
  const next = String(markdown ?? '')
  if (next.length > 250000) throw new AgentError('la nota supera 250 KB', 'E_USAGE')

  await db.patch(
    'notes',
    doc.id,
    { markdown: next, tags: extractTags(next) },
    {
      updateTime: doc.updateTime,
      transforms: [{ fieldPath: 'version', increment: 1 }, { fieldPath: 'updatedAt' }],
    }
  )

  return {
    id: doc.id,
    etag: etagOf({ markdown: next, version: (doc.data.version ?? 0) + 1 }),
    delta: next.length - String(doc.data.markdown ?? '').length,
  }
}

export async function appendNote(db, ref, text) {
  if (!text) throw new AgentError('falta el texto', 'E_USAGE')
  const doc = await resolveNote(db, ref)
  const current = String(doc.data.markdown ?? '')
  const next = current.endsWith('\n') ? `${current}${text}` : `${current}\n${text}`

  await db.patch(
    'notes',
    doc.id,
    { markdown: next, tags: extractTags(next) },
    {
      updateTime: doc.updateTime,
      transforms: [{ fieldPath: 'version', increment: 1 }, { fieldPath: 'updatedAt' }],
    }
  )

  return {
    id: doc.id,
    etag: etagOf({ markdown: next, version: (doc.data.version ?? 0) + 1 }),
    delta: next.length - current.length,
  }
}

/**
 * Creates a note as the agent. The rules require the agent to mirror the
 * folder's ACL, which is exactly what a note created in a folder does.
 */
export async function createNote(db, { title = 'Sin título', folder, body = '' } = {}) {
  if (!folder) throw new AgentError('falta --folder: el agente solo crea dentro de carpetas', 'E_USAGE')
  const target = await resolveFolder(db, folder)
  const acl = {
    memberIds: target.data.memberIds,
    roles: target.data.roles,
    access: target.data.access,
  }

  const id = db.newId()
  await db.create(
    'notes',
    id,
    {
      // Rules require the creator to own the note; the ACL still comes from the
      // folder, so the agent cannot widen access.
      ownerId: db.uid,
      folderId: target.id,
      aclSource: 'folder',
      ...acl,
      title: String(title).slice(0, 300),
      markdown: String(body),
      tags: extractTags(String(body)),
      version: 1,
    },
    { transforms: [{ fieldPath: 'createdAt' }, { fieldPath: 'updatedAt' }] }
  )

  return { id, short: shortId(id) }
}

export async function deleteNote(db, ref) {
  const doc = await resolveNote(db, ref)
  await db.remove('notes', doc.id)
  return { id: doc.id }
}

/** Tag inventory with counts, from the notes this identity can see. */
export async function listTags(db) {
  const docs = await db.query('notes', {
    where: memberFilter(db),
    select: { fields: [{ fieldPath: 'tags' }, { fieldPath: 'memberIds' }] },
    limit: 300,
  })

  const counts = new Map()
  for (const doc of docs) {
    for (const tag of doc.data.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  if (counts.size === 0) return ''
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => `${tag}\t${count}`)
    .join('\n')
}

/** Searches bodies; returns `id:line: text` with no surrounding context by default. */
export async function searchNotes(db, query, { limit = 20, context = 0, notes = 200, tag } = {}) {
  if (!query && !tag) throw new AgentError('falta la búsqueda', 'E_USAGE')
  const needle = String(query ?? '').toLowerCase()
  const wantedTag = tag ? String(tag).replace(/^#/, '').toLowerCase() : null

  const docs = await db.query('notes', {
    where: memberFilter(db),
    orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
    select: {
      fields: [
        { fieldPath: 'title' },
        { fieldPath: 'markdown' },
        { fieldPath: 'tags' },
        { fieldPath: 'memberIds' },
      ],
    },
    limit: Math.min(Number(notes) || 200, 300),
  })

  const out = []
  for (const doc of docs) {
    if (wantedTag && !(doc.data.tags ?? []).includes(wantedTag)) continue
    const lines = String(doc.data.markdown ?? '').split('\n')
    if (!needle) {
      out.push(`${shortId(doc.id)}: ${doc.data.title ?? ''}`)
      if (out.length >= limit) return out.join('\n')
      continue
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue
      if (context > 0) {
        const from = Math.max(0, i - context)
        const to = Math.min(lines.length, i + context + 1)
        out.push(`${shortId(doc.id)}:${i + 1}: ${lines.slice(from, to).join(' ⏎ ')}`)
      } else {
        out.push(`${shortId(doc.id)}:${i + 1}: ${lines[i].trim()}`)
      }
      if (out.length >= limit) return out.join('\n')
    }
  }
  return out.join('\n')
}
