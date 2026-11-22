import type { ProviderStatus } from './collab/provider'

/**
 * Sync state has exactly three readable tones. It is shown as a bare dot next
 * to the user's avatar; the word only appears when the dot is tapped, so a
 * healthy connection costs no chrome.
 */
export type SyncTone = 'ok' | 'pending' | 'error'

/**
 * A real failure wins, then anything that means "not on the server yet" (a
 * dropped socket, a cached snapshot, writes in flight), then silence.
 *
 * `offline` exists because the listener keeps serving cached snapshots when the
 * socket is down: without it the dot stayed green while the user typed into a
 * dead connection.
 */
export function syncTone(status: ProviderStatus): SyncTone {
  if (status.error) return 'error'
  if (status.offline || status.pendingWrites > 0 || !status.connected) return 'pending'
  return 'ok'
}

export function syncText(status: ProviderStatus): string {
  if (status.error) return 'Error de sincronización'
  if (status.offline) return 'Sin conexión'
  if (status.pendingWrites > 0) return 'Guardando'
  if (!status.connected) return 'Conectando'
  return 'Sincronizado'
}

/**
 * The sentence under the word, shown when the dot is tapped and announced to
 * screen readers. The word alone cannot say *why*, and "Error de
 * sincronización" without a reason is worse than no status at all.
 */
export function syncDetail(status: ProviderStatus): string | null {
  if (status.error) return status.error
  if (status.offline) return 'Tus cambios se guardan acá y se sincronizan al reconectar.'
  if (status.pendingWrites > 0) {
    return `${status.pendingWrites} ${status.pendingWrites === 1 ? 'cambio' : 'cambios'} sin enviar`
  }
  // "Conectando" already says everything there is to say while it connects.
  return null
}
