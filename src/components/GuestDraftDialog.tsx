import { Modal } from './Modal'
import { useT } from '../i18n/index.ts'

interface GuestDraftDialogProps {
  title: string
  busy: boolean
  error: string | null
  onSave: () => void
  onDiscard: () => void
  onClose: () => void
}

/**
 * Offered once, after the first sign-in with a non-empty draft. It is a real
 * choice, not a popup on the editor: "keep it in my account" or "discard it".
 * Closing the dialog keeps the draft in `localStorage` for the next visit.
 */
export function GuestDraftDialog({
  title,
  busy,
  error,
  onSave,
  onDiscard,
  onClose,
}: GuestDraftDialogProps) {
  const t = useT()

  return (
    <Modal labelledBy="guest-draft-heading" onClose={onClose}>
      <h2 id="guest-draft-heading">{t('guest.dialogTitle')}</h2>
      <p className="share-hint-box">{t('guest.dialogBody')}</p>
      <p className="hint" style={{ fontFamily: 'var(--font-mono)' }}>
        {title}
      </p>
      {error && <p className="hint tone-danger">{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onDiscard} disabled={busy}>
          {t('guest.dialogDiscard')}
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={busy}>
          {t('guest.dialogKeep')}
        </button>
      </div>
    </Modal>
  )
}
