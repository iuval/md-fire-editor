import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { useT } from '../i18n/index.ts'

interface ConfirmDialogProps {
  /** The question, as the heading. */
  title: string
  /** What happens if the button is pressed. */
  body?: string
  /** The action, named by what it does ("Delete"), never "OK". */
  confirmLabel: string
  /** Shown on the button while the action runs. */
  busyLabel?: string
  cancelLabel?: string
  /** Paints the action as destructive. */
  danger?: boolean
  /** Runs the action. A promise keeps the dialog open until it settles. */
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

/**
 * Approval for an action that cannot be undone, in the app's own dialog.
 *
 * `window.confirm` was the browser's: it blocks the page, cannot be read by a
 * screen reader as part of the app, ignores the theme, and on iOS it announces
 * the origin — a website asking, not this app.
 *
 * An action that talks to the server is waited on: the button reads "Deleting…"
 * and the reason for a refusal appears here, next to the question, instead of
 * the dialog closing over a folder that never left. Cancel stays available, so
 * a slow action can be dismissed rather than trapping the page. Escape or the
 * scrim means no, and focus starts on Cancel, so the safe answer is the one
 * Enter reaches first.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The action can outlive the dialog (it was dismissed mid-flight); reporting
  // into an unmounted component is pointless state.
  const alive = useRef(true)

  const dismiss = () => {
    alive.current = false
    onClose()
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      if (alive.current) onClose()
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error && e.message ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal labelledBy="confirm-heading" onClose={dismiss}>
      <h2 id="confirm-heading">{title}</h2>
      {body && <p className="share-hint-box">{body}</p>}
      {error && (
        <p className="hint tone-danger" role="alert">
          {error}
        </p>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={dismiss}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          type="button"
          className={`btn${danger ? ' danger' : ''}`}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? (busyLabel ?? t('common.working')) : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
