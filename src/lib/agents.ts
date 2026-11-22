import { collection, doc, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Un agente conectado: una sesión de la CLI (o de la app de escritorio) que
 * entró con esta cuenta. El id lo elige la sesión al loguearse y no cambia; el
 * nombre sí, desde acá o desde `mdfire name`.
 */
export interface Agent {
  id: string
  name: string
  kind: string
  version: string
  createdAt: Date | null
  lastSeenAt: Date | null
}

export const MAX_AGENT_NAME = 80

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  const timestamp = value as { toDate?: () => Date } | null
  return typeof timestamp?.toDate === 'function' ? timestamp.toDate() : null
}

function toAgent(id: string, data: Record<string, unknown>): Agent {
  return {
    id,
    name: typeof data.name === 'string' && data.name ? data.name : 'Sin nombre',
    kind: typeof data.kind === 'string' ? data.kind : 'cli',
    version: typeof data.version === 'string' ? data.version : '',
    createdAt: toDate(data.createdAt),
    lastSeenAt: toDate(data.lastSeenAt),
  }
}

/** Los agentes conectados a esta cuenta, el más reciente primero. */
export function subscribeMyAgents(
  uid: string,
  onChange: (agents: Agent[]) => void,
  onError: (message: string) => void
): () => void {
  if (!db) return () => undefined
  const q = query(
    collection(db, 'agents'),
    where('ownerUid', '==', uid),
    orderBy('lastSeenAt', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toAgent(d.id, d.data()))),
    (err) => onError(err.message)
  )
}

/** Nombre limpio, o null si quedó vacío. */
export function cleanAgentName(value: string): string | null {
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT_NAME)
  return name || null
}

export async function renameAgent(agentId: string, name: string): Promise<void> {
  const clean = cleanAgentName(name)
  if (!clean) throw new Error('El nombre no puede quedar vacío')
  if (!db) throw new Error('Firebase no está configurado')
  await updateDoc(doc(db, 'agents', agentId), { name: clean })
}
