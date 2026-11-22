// Agentes conectados: las sesiones que entraron con la cuenta (CLI, MCP, app).
//
// No son permisos. Desde que la CLI entra con la cuenta del usuario, cada
// sesión ya tiene los mismos permisos que la persona; el registro `agents/{id}`
// es sólo la lista de "quién está conectado" para poder nombrarlas
// ("MacBook de Juan", "servidor de deploy") desde la CLI o desde la app.

import { hostname } from 'node:os'
import { AgentError, shortId } from './core.mjs'

const COLLECTION = 'agents'
export const MAX_NAME = 80

/** Nombre por defecto: el host, para reconocer la sesión sin configurar nada. */
export function defaultAgentName() {
  const host = hostname().replace(/\.local$/i, '').trim()
  return `${host || 'CLI'} · cli`
}

/** Un nombre en una línea, sin espacios de más y con tope de 80 caracteres. */
export function cleanName(value) {
  const name = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) throw new AgentError('el nombre no puede quedar vacío', 'E_USAGE')
  if (name.length > MAX_NAME) {
    throw new AgentError(`el nombre no puede pasar de ${MAX_NAME} caracteres`, 'E_USAGE')
  }
  return name
}

function day(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toISOString().slice(0, 10)
}

/**
 * Crea o actualiza el registro de esta sesión. Devuelve `{ id, name }`.
 * El id se guarda en las credenciales para que la sesión se reconozca al
 * volver: sin eso, cada login dejaría un agente nuevo en la lista.
 */
export async function registerAgent(db, { id, name, kind = 'cli', version = '' } = {}) {
  if (!db?.uid) throw new AgentError('no se pudo determinar la identidad', 'E_USAGE')
  const agentId = id || db.newId()
  const label = cleanName(name || defaultAgentName())
  const now = new Date()
  const existing = await db.get(COLLECTION, agentId)

  if (existing) {
    // El nombre guardado manda: si lo cambiaron en la app o con `firemd name`,
    // volver a entrar no lo pisa. Sólo se refresca el "último uso".
    const patch = { lastSeenAt: now }
    if (existing.data?.kind !== kind) patch.kind = kind
    await db.patch(COLLECTION, agentId, patch)
    return { id: agentId, name: existing.data?.name ?? label }
  } else {
    await db.create(COLLECTION, agentId, {
      ownerUid: db.uid,
      name: label,
      kind,
      version,
      createdAt: now,
      lastSeenAt: now,
    })
  }

  return { id: agentId, name: label }
}

/** Los agentes de esta cuenta, el más reciente primero. */
export async function listAgents(db) {
  const docs = await db.query(COLLECTION, {
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'ownerUid' },
              op: 'EQUAL',
              value: { stringValue: db.uid },
            },
          },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: 'lastSeenAt' }, direction: 'DESCENDING' }],
    limit: 50,
  })
  return docs.map((doc) => ({ id: doc.id, ...doc.data }))
}

/** Acepta id completo, prefijo único o nombre exacto. */
export async function resolveAgent(db, ref) {
  const needle = String(ref ?? '').trim()
  if (!needle) throw new AgentError('falta el agente', 'E_USAGE')
  const agents = await listAgents(db)
  const exact = agents.find((agent) => agent.id === needle)
  if (exact) return exact
  const matches = agents.filter(
    (agent) => agent.id.startsWith(needle) || agent.name === needle
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new AgentError(`"${needle}" coincide con ${matches.length} agentes`, 'E_AMBIGUOUS')
  }
  throw new AgentError(`no encontré el agente ${needle}`, 'E_NOT_FOUND')
}

export async function renameAgent(db, ref, name) {
  const label = cleanName(name)
  const agent = await resolveAgent(db, ref)
  await db.patch(COLLECTION, agent.id, { name: label })
  return { id: agent.id, name: label }
}

/** Tabla para la terminal: id corto, nombre, tipo y último uso. */
export function formatAgents(agents, { currentId } = {}) {
  return agents
    .map((agent) => {
      const mark = agent.id === currentId ? ' *' : ''
      return `${shortId(agent.id)}${mark}\t${agent.name}\t${agent.kind ?? 'cli'}\t${day(agent.lastSeenAt)}`
    })
    .join('\n')
}
