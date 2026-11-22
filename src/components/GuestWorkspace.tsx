import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.ts'
import { readGuestDraft, writeGuestDraft, type GuestDraft } from '../lib/guestDraft'
import { trackGuest } from '../lib/guestAnalytics'
import { CollaborativeEditor } from './CollaborativeEditor'
import type { Note } from '../lib/notes'

interface GuestWorkspaceProps {
  onSignIn: () => void
  authError?: string | null
  /** Tests only: shorten the debounce so they do not wait 400 ms. */
  debounceMs?: number
}

const noop = () => undefined

/**
 * The visitor's editor: the real editor stack (Tiptap + Yjs + the markdown
 * serializer), with no Firestore document behind it. The body is persisted in
 * `localStorage`; the note becomes real when the visitor signs in and accepts
 * the migration.
 *
 * It is the same editor the app uses — same typography, same markdown, same
 * formatting bar on phones — so the first screen is the product, not a
 * teaser. The only difference is where the document lives.
 */
export function GuestWorkspace({ onSignIn, authError, debounceMs = 400 }: GuestWorkspaceProps) {
  const t = useT()
  const [draft, setDraft] = useState<GuestDraft>(() => readGuestDraft() ?? { title: '', markdown: '', savedAt: 0 })
  // The editor owns the document once mounted; the draft only records what it
  // emits. Passing the live draft back as `body` would re-serialize and set the
  // content on every keystroke.
  const [initialBody] = useState(draft.markdown)
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
    return () => {
      flush()
    }
    // The flush closes over refs only; it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onBeforeUnload = () => flush()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
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

  /** The document is in memory: the guest note never touches Firestore. */
  const note: Note = {
    id: 'guest-draft',
    title: draft.title,
    markdown: draft.markdown,
    kind: 'note',
    folderId: null,
    ownerId: '',
    aclSource: 'own',
    memberIds: [],
    roles: {},
    access: 'restricted',
    tags: [],
    order: 0,
    version: 1,
  }

  return (
    <div className="guest">
      <div className="doc">
        <div className="doc-header">
          <input
            className="inline-title"
            value={draft.title}
            onChange={(event) => change({ title: event.target.value })}
            placeholder={t('guest.titlePlaceholder')}
            aria-label={t('guest.titleLabel')}
            spellCheck={false}
          />
        </div>
        <CollaborativeEditor
          key="guest-draft"
          note={note}
          body={initialBody}
          uid=""
          userName={t('app.anonymous')}
          editable
          local
          placeholder={t('guest.welcome')}
          onMarkdownChange={(markdown) => change({ markdown })}
          onPresence={noop}
          onStatus={noop}
        />
        {authError && <p className="hint tone-danger">{authError}</p>}
      </div>

      <div className="guest-strip" role="region" aria-label={t('guest.stripLabel')}>
        <a className="guest-strip-link" href="/planes#que-es" onClick={() => trackGuest('pricing_viewed')}>
          {t('guest.whatIs')}
        </a>
        <a className="guest-strip-link" href="/planes#planes" onClick={() => trackGuest('pricing_viewed')}>
          {t('guest.plans')}
        </a>
        <span className="guest-strip-spacer" />
        {dirty && Boolean(draft.markdown.trim() || draft.title.trim()) && (
          <button className="btn" onClick={signIn}>
            {t('guest.save')}
          </button>
        )}
        <button className="btn ghost" onClick={signIn}>
          {t('guest.signIn')}
        </button>
      </div>
    </div>
  )
}
