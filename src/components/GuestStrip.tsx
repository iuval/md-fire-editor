import { Modal } from './Modal'
import { useT } from '../i18n/index.ts'

interface GuestStripProps {
  onSignIn: () => void
  onInfo: () => void
  /** The panel is collapsed: keep the button, drop the reading matter. */
  compact?: boolean
}

/**
 * The 36 px bar above the editor for a visitor without a session.
 *
 * It is the only difference between the visitor's frame and the signed-in one:
 * the sidebar, the tabs, the panes and the editor are the same components. The
 * bar carries the free quota and one sign-in button, and nothing else — the
 * brief's rule is that no popup ever interrupts typing.
 */
export function GuestStrip({ onSignIn, onInfo, compact = false }: GuestStripProps) {
  const t = useT()

  return (
    <div className="guest-strip" role="region" aria-label={t('guest.stripLabel')}>
      {!compact && <p className="guest-strip-quota">{t('guest.quota')}</p>}
      <div className="guest-strip-actions">
        {!compact && (
          <button type="button" className="guest-strip-link" onClick={onInfo}>
            {t('guest.whatIs')}
          </button>
        )}
        <button type="button" className="btn guest-strip-signin" onClick={onSignIn}>
          {t('guest.signIn')}
        </button>
      </div>
    </div>
  )
}

interface GuestInfoDialogProps {
  onSignIn: () => void
  onClose: () => void
}

/**
 * What the visitor gets if they sign in: the four pillars and the free tier.
 * Opened from the strip, never on its own — the editor stays the first screen.
 */
export function GuestInfoDialog({ onSignIn, onClose }: GuestInfoDialogProps) {
  const t = useT()

  return (
    <Modal labelledBy="guest-info-heading" onClose={onClose}>
      <h2 id="guest-info-heading">{t('guest.infoTitle')}</h2>
      <p className="guest-info-lead">{t('guest.infoLead')}</p>
      <ul className="guest-info-list">
        <li>{t('guest.infoCollab')}</li>
        <li>{t('guest.infoFolders')}</li>
        <li>{t('guest.infoAgents')}</li>
        <li>{t('guest.infoPortable')}</li>
      </ul>
      <p className="share-hint-box">{t('guest.infoPlans')}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('guest.infoClose')}
        </button>
        <button type="button" className="btn" onClick={onSignIn}>
          {t('guest.signIn')}
        </button>
      </div>
    </Modal>
  )
}
