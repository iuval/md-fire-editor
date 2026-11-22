import type { ProviderStatus } from '../lib/collab/provider'
import { syncText } from '../lib/syncStatus'

/**
 * The status words, announced but never painted.
 *
 * The visible dot lives next to the avatar in the sidebar footer, which can be
 * collapsed or closed behind a phone drawer — so the live region sits in the
 * pane itself, where a layout without a top bar still keeps it mounted.
 */
export function SyncAnnouncer({ status }: { status: ProviderStatus }) {
  return (
    <span className="sr-only" role="status">
      {syncText(status)}
    </span>
  )
}
