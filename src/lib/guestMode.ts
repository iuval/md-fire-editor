/**
 * One condition, written once. The visitor editor and its discovery strip only
 * exist when there is no session *and* the URL is not a shared-note link.
 *
 * A shared note must keep the login wall: the visitor has no access to that
 * document, and showing a local draft there would promise an editor that cannot
 * read the note. Logged-in sessions never see the strip either.
 */
export interface GuestViewContext {
  hasUser: boolean
  hasSharedNote: boolean
}

export function shouldShowGuestView({ hasUser, hasSharedNote }: GuestViewContext): boolean {
  return !hasUser && !hasSharedNote
}
