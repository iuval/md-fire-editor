// Agent-facing core: minimal Firestore access for notes.
//
// Design goal: every response is the smallest thing an LLM needs.
//   - listings are TSV with short ids, never JSON
//   - reads return raw markdown, plus an etag so a follow-up patch does not
//     have to re-read the note
//   - writes are exact-substring replacements, so the model never has to
//     re-emit a whole document
//
// Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or
// `gcloud auth application-default login`) or MDFIRE_ACCESS_TOKEN.
// The Admin SDK bypasses security rules by design — run it as the project
// owner, on the owner's machine.

import { createHash } from 'node:crypto'
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const DEFAULT_PROJECT = 'md-sync-app'

export class AgentError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

export function openStore(options = {}) {
  const projectId = options.project || process.env.MDFIRE_PROJECT || DEFAULT_PROJECT
  const emulator = process.env.FIRESTORE_EMULATOR_HOST

  if (getApps().length === 0) {
    if (emulator) {
      initializeApp({ projectId })
    } else if (process.env.MDFIRE_ACCESS_TOKEN) {
      const token = process.env.MDFIRE_ACCESS_TOKEN
      initializeApp({
        projectId,
        credential: {
          getAccessToken: async () => ({
            access_token: token,
            expires_in: Math.floor((Number(process.env.MDFIRE_TOKEN_TTL) || 3000)),
          }),
        },
      })
    } else {
      initializeApp({ projectId, credential: applicationDefault() })
    }
  }

  return getFirestore()
}

export function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function etagOf(data) {
  return `${data.version ?? 0}-${hash(String(data.markdown ?? ''))}`
}

/** Short, human-typable id derived from the document id. */
export function shortId(id) {
  return id.slice(0, 8)
}

function day(ts) {
  const date = ts?.toDate?.() ?? (ts instanceof Date ? ts : null)
  if (!date) return '-'
  return date.toISOString().slice(0, 10)
}

/**
 * `id  title  updated  folder` — one line per note, nothing else.
 * Only these four fields are fetched, so listing 100 notes costs no markdown.
 */
export async function listNotes(db, { folder, limit = 50 } = {}) {
  let query = db.collection('notes').orderBy('updatedAt', 'desc')
  if (folder === 'root') {
    query = db.collection('notes').where('folderId', '==', null).orderBy('updatedAt', 'desc')
  } else if (folder) {
    const target = await resolveFolder(db, folder)
    query = db.collection('notes').where('folderId', '==', target.id).orderBy('updatedAt', 'desc')
  }

  const snap = await query.limit(Math.min(Number(limit) || 50, 200)).select('title', 'updatedAt', 'folderId').get()
  if (snap.empty) return ''

  const folders = await folderNames(db)
  return snap.docs
    .map((doc) => {
      const d = doc.data()
      const folderName = d.folderId ? (folders.get(d.folderId) ?? d.folderId.slice(0, 6)) : '-'
      return `${shortId(doc.id)}\t${(d.title || 'Sin título').replace(/\s+/g, ' ')}\t${day(d.updatedAt)}\t${folderName}`
    })
    .join('\n')
}

export async function folderNames(db) {
  const snap = await db.collection('folders').select('name').get()
  const map = new Map()
  snap.docs.forEach((doc) => map.set(doc.id, doc.data().name || 'Carpeta'))
  return map
}

export async function listFolders(db) {
  const snap = await db.collection('folders').orderBy('name').select('name').get()
  if (snap.empty) return ''
  return snap.docs.map((doc) => `${shortId(doc.id)}\t${doc.data().name || 'Carpeta'}`).join('\n')
}

/** Resolve a full id or a unique prefix to a note document. */
export async function resolveNote(db, ref) {
  if (!ref) throw new AgentError('falta el id de la nota', 'E_USAGE')
  const direct = await db.collection('notes').doc(ref).get()
  if (direct.exists) return direct

  const prefix = ref.slice(0, 8)
  // listDocuments() returns refs without reading any document body.
  const refs = await db.collection('notes').listDocuments()
  const matches = refs.filter((docRef) => docRef.id.startsWith(prefix))
  if (matches.length === 1) return matches[0].get()
  if (matches.length === 0) throw new AgentError(`no encontré la nota ${ref}`, 'E_NOT_FOUND')
  throw new AgentError(`id ambiguo ${ref}: ${matches.map((m) => shortId(m.id)).join(', ')}`, 'E_AMBIGUOUS')
}

export async function resolveFolder(db, ref) {
  const direct = await db.collection('folders').doc(ref).get()
  if (direct.exists) return direct
  // Full documents: callers need memberIds/roles/access to inherit the ACL.
  const snap = await db.collection('folders').limit(500).get()
  const matches = snap.docs.filter(
    (doc) => doc.id.startsWith(ref) || (doc.data().name || '').toLowerCase() === String(ref).toLowerCase()
  )
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new AgentError(`no encontré la carpeta ${ref}`, 'E_NOT_FOUND')
  throw new AgentError(`carpeta ambigua ${ref}`, 'E_AMBIGUOUS')
}

/** Raw markdown only. The etag travels separately so it never pollutes the body. */
export async function readNote(db, ref, { maxBytes = 0 } = {}) {
  const doc = await resolveNote(db, ref)
  const data = doc.data()
  let body = String(data.markdown ?? '')
  let truncated = false
  if (maxBytes && body.length > maxBytes) {
    body = `${body.slice(0, maxBytes)}\n…[truncado ${body.length - maxBytes} bytes]`
    truncated = true
  }
  return { id: doc.id, title: data.title ?? '', body, etag: etagOf(data), truncated }
}

/**
 * Apply exact substring replacements. Returns byte deltas, not the new body:
 * the caller already knows what it wrote.
 */
export async function patchNote(db, ref, edits, { etag, replaceAll = false } = {}) {
  if (!Array.isArray(edits) || edits.length === 0) throw new AgentError('no hay ediciones', 'E_USAGE')

  const doc = await resolveNote(db, ref)
  const data = doc.data()
  const current = String(data.markdown ?? '')

  if (etag && etag !== etagOf(data)) {
    throw new AgentError(`etag desactualizado (actual ${etagOf(data)})`, 'E_ETAG')
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

  await doc.ref.update({
    markdown: next,
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return {
    id: doc.id,
    etag: etagOf({ markdown: next, version: (data.version ?? 0) + 1 }),
    delta: next.length - current.length,
    edits: applied.length,
  }
}

export async function appendNote(db, ref, text) {
  if (!text) throw new AgentError('falta el texto', 'E_USAGE')
  const doc = await resolveNote(db, ref)
  const current = String(doc.data().markdown ?? '')
  const next = current.endsWith('\n') ? `${current}${text}` : `${current}\n${text}`

  await doc.ref.update({
    markdown: next,
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id: doc.id, etag: etagOf({ markdown: next, version: (doc.data().version ?? 0) + 1 }), delta: next.length - current.length }
}

export async function createNote(db, { title = 'Sin título', folder, ownerId, body = '' } = {}) {
  if (!ownerId) throw new AgentError('falta --owner (uid del dueño)', 'E_USAGE')

  let folderDoc = null
  if (folder) folderDoc = await resolveFolder(db, folder)
  const acl = folderDoc
    ? {
        memberIds: folderDoc.data().memberIds,
        roles: folderDoc.data().roles,
        access: folderDoc.data().access,
      }
    : { memberIds: [ownerId], roles: { [ownerId]: 'owner' }, access: 'restricted' }

  const ref = db.collection('notes').doc()
  await ref.set({
    ownerId,
    folderId: folderDoc ? folderDoc.id : null,
    aclSource: folderDoc ? 'folder' : 'own',
    ...acl,
    title: String(title).slice(0, 300),
    markdown: String(body),
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id: ref.id, short: shortId(ref.id) }
}

export async function deleteNote(db, ref) {
  const doc = await resolveNote(db, ref)
  await doc.ref.delete()
  return { id: doc.id }
}

/**
 * Substring search across note bodies. Firestore has no full-text index, so
 * this scans the most recent notes only: results are `id:line: text`, with no
 * surrounding context unless asked.
 */
export async function searchNotes(db, query, { limit = 20, context = 0, notes = 200 } = {}) {
  if (!query) throw new AgentError('falta la búsqueda', 'E_USAGE')
  const needle = String(query).toLowerCase()

  const snap = await db
    .collection('notes')
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(Number(notes) || 200, 400))
    .select('title', 'markdown')
    .get()

  const out = []
  for (const doc of snap.docs) {
    const lines = String(doc.data().markdown ?? '').split('\n')
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
