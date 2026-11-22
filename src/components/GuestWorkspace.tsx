import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.ts'
import { readGuestDraft, writeGuestDraft, type GuestDraft } from '../lib/guestDraft'
import { trackGuest } from '../lib/guestAnalytics'

interface GuestWorkspaceProps {
  onSignIn: () => void
  authError?: string | null
  /** Tests only: shorten the debounce so they do not wait 400 ms. */
  debounceMs?: number
}

/**
 * The visitor's editor: a title and a body, persisted in `localStorage`, with a
 * 36 px discovery strip. No modal, no login wall, no hero over the editor.
 *
 * It is intentionally not the collaborative editor. A visitor has no document
 * to sync and no ACL to enforce; mounting the CRDT stack would mean writing a
 * Firestore provider for a note that does not exist. The note becomes real only
 * when the visitor signs in and accepts the migration.
 */
export function GuestWorkspace({ onSignIn, authError, debounceMs = 400 }: GuestWorkspaceProps) {
  const t = useT()
  const [draft, setDraft] = useState<GuestDraft>(
    () => readGuestDraft() ?? { title: '', markdown: '', savedAt: 0 }
  )
  const [dirty, setDirty] = useState(false)
  const latest = useRef(draft)
  const timer = useRef<number | null>(null)
  const started = useRef(false)

  latest.current = draft

  const flush = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    writeGuestDraft({ ...latest.current, savedAt: Date.now() })
  }

  useEffect(() => {
    trackGuest('landing_viewed')
    const onBeforeUnload = () => flush()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
    // The flush closes over refs only; it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (patch: Partial<GuestDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      latest.current = next
      return next
    })
    setDirty(true)

    if (!started.current && (patch.markdown ?? '').trim().length > 0) {
      started.current = true
      trackGuest('guest_draft_started')
    }

    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      writeGuestDraft({ ...latest.current, savedAt: Date.now() })
      trackGuest('guest_draft_saved')
    }, debounceMs)
  }

  const signIn = () => {
    trackGuest('guest_signin_clicked')
    flush()
    onSignIn()
  }

  const visitPlans = () => trackGuest('pricing_viewed')

  return (
    <div className="guest">
      <div className="guest-editor">
        <input
          className="guest-title"
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
          placeholder={t('guest.titlePlaceholder')}
          aria-label={t('guest.titleLabel')}
          spellCheck={false}
        />
        <textarea
          className="guest-body"
          autoFocus
          value={draft.markdown}
          onChange={(event) => change({ markdown: event.target.value })}
          placeholder={t('guest.welcome')}
          aria-label={t('guest.bodyLabel')}
          spellCheck
        />
        {authError && <p className="hint tone-danger">{authError}</p>}
      </div>

      <div className="guest-strip" role="region" aria-label={t('guest.stripLabel')}>
        <a className="guest-strip-link" href="/planes#que-es" onClick={visitPlans}>
          {t('guest.whatIs')}
        </a>
        <a className="guest-strip-link" href="/planes#planes" onClick={visitPlans}>
          {t('guest.plans')}
        </a>
        <span className="guest-strip-spacer" />
        {dirty && Boolean(draft.markdown.trim() || draft.title.trim()) && (
          <button type="button" className="btn guest-strip-save" onClick={signIn}>
            {t('guest.save')}
          </button>
        )}
        <button type="button" className="btn ghost guest-strip-signin" onClick={signIn}>
          {t('guest.signIn')}
        </button>
      </div>
    </div>
  )
}
