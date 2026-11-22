import type { ProviderStatus } from './collab/provider'

/**
 * Sync state has exactly three readable tones. It is shown as a bare dot next
 * to the user's avatar; the word only appears when the dot is tapped, so a
 * healthy connection costs no chrome.
 */
export type SyncTone = 'ok' | 'pending' | 'error'

/** Error wins, then unsaved writes or a dropped socket, then silence. */
export function syncTone(status: ProviderStatus): SyncTone {
  if (status.error) return 'error'
  if (status.pendingWrites > 0 || !status.connected) return 'pending'
  return 'ok'
}

export function syncText(status: ProviderStatus): string {
  if (status.error) return 'Sin conexión'
  if (status.pendingWrites > 0) return 'Guardando'
  if (!status.connected) return 'Conectando'
  return 'Sincronizado'
}
