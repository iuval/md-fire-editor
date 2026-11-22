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
  // The word only, never the detail: this is a live region, and the pending
  // count changes on every burst of typing, so mentioning it would make a
  // screen reader interrupt itself constantly. The reason lives in the dot's
  // label, which is read when the user asks for it.
  return (
    <span className="sr-only" role="status">
      {syncText(status)}
    </span>
  )
}
