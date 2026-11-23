// @vitest-environment jsdom
/**
 * The visitor's frame is the real one: the same `AppTree` renders the sidebar,
 * the panes and the editor, with the local store as transport. There is no extra
 * chrome at all — the first visit seeds two notes instead: an empty one with the
 * caret in it, and a "Welcome to FireMD" one that explains what this is. These
 * tests pin that copy and the decision that a shared note still needs a session.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { t } from '../src/i18n/index.ts'
import { shouldShowGuestView } from '../src/lib/guestMode'

beforeEach(() => {
  localStorage.clear()
})

describe('shouldShowGuestView', () => {
  it('shows the real editor without a session', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: false })).toBe(true)
  })

  it('keeps the login wall for shared-note links', () => {
    expect(shouldShowGuestView({ hasUser: false, hasSharedNote: true })).toBe(false)
  })

  it('never shows the visitor frame inside a session', () => {
    expect(shouldShowGuestView({ hasUser: true, hasSharedNote: false })).toBe(false)
  })
})

describe('the note a visitor finds', () => {
  it('is titled Welcome to FireMD', () => {
    expect(t('guest.welcomeTitle')).toBe('Welcome to FireMD')
  })

  it('says what FireMD is: the four pillars and the free tier', () => {
    const body = t('guest.welcomeBody')
    expect(body).toContain('collaborative Markdown editor')
    expect(body).toContain('CRDT')
    expect(body).toContain('permissions')
    expect(body).toContain('firemd patch')
    expect(body).toContain('Markdown stays Markdown')
    expect(body).toContain('100 MB')
  })

  it('points at the account menu for signing in, now that the strip is gone', () => {
    // The strip was the only visible sign-in button; the note has to say where
    // the remaining one lives, or a visitor cannot save anything.
    expect(t('guest.welcomeBody')).toContain('gear menu')
  })
})
