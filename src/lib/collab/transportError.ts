/**
 * What a transport failure means to the person typing.
 *
 * A dropped socket and a rejected write are not the same event, and telling
 * them apart is the difference between "your work is safe, it will sync" and
 * "something is wrong with this note". The strings come from Firestore, so the
 * matching is on message text — the SDK does not expose a stable code here.
 */
export interface TransportFailure {
  /** The backend is unreachable; local edits are queued, nothing is lost. */
  offline: boolean
  /** A real, readable failure, or `null` when the only problem is the network. */
  error: string | null
}

const OFFLINE = /unavailable|offline|network|timeout|deadline|connection|failed to get/i
const PERMISSION = /permission|insufficient/i

export function classifyTransportError(err: unknown): TransportFailure {
  const raw = err instanceof Error ? err.message : String(err)

  if (PERMISSION.test(raw)) {
    return { offline: false, error: 'No tenés permiso para editar esta nota' }
  }
  if (OFFLINE.test(raw)) {
    return { offline: true, error: null }
  }
  return { offline: false, error: raw }
}
