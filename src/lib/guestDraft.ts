import { MAX_MARKDOWN_BYTES } from './notes'

/**
 * The guest's draft: the only thing a visitor can write before signing in.
 *
 * It is deliberately *not* a second note store. It holds a title and a body in
 * `localStorage`, and the cloud side is a one-way migration into `notes.ts` when
 * the visitor decides to keep it. Keeping the surface this small is what stops
 * the two paths from drifting (see `docs/onboarding-first-visit.md`, risk 2).
 */

export const GUEST_DRAFT_KEY = 'firemd-guest-draft'

export interface GuestDraft {
  title: string
  markdown: string
  /** Epoch milliseconds; used to order the migration prompt, not for sync. */
  savedAt: number
}

/** `localStorage` in a browser, `null` when it is unavailable (private mode). */
function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readGuestDraft(store: Storage | null = defaultStorage()): GuestDraft | null {
  if (!store) return null
  try {
    const raw = store.getItem(GUEST_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GuestDraft> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.title !== 'string' || typeof parsed.markdown !== 'string') return null
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0
    return {
      title: parsed.title.slice(0, 120),
      markdown: parsed.markdown.slice(0, MAX_MARKDOWN_BYTES),
      savedAt,
    }
  } catch {
    return null
  }
}

export function writeGuestDraft(
  draft: GuestDraft,
  store: Storage | null = defaultStorage()
): boolean {
  if (!store) return false
  try {
    store.setItem(
      GUEST_DRAFT_KEY,
      JSON.stringify({
        title: draft.title.slice(0, 120),
        markdown: draft.markdown.slice(0, MAX_MARKDOWN_BYTES),
        savedAt: draft.savedAt,
      })
    )
    return true
  } catch {
    // Quota exceeded or storage disabled: the draft still lives in memory.
    return false
  }
}

export function clearGuestDraft(store: Storage | null = defaultStorage()): void {
  try {
    store?.removeItem(GUEST_DRAFT_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** A draft with a body is worth offering to save; an empty one is not. */
export function isMigratable(draft: GuestDraft | null): draft is GuestDraft {
  return Boolean(draft && draft.markdown.trim().length > 0)
}

/** Title to use when the draft has none: the first meaningful line. */
export function guestDraftTitle(draft: GuestDraft): string {
  const explicit = draft.title.trim()
  if (explicit) return explicit.slice(0, 120)
  const first = draft.markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return (first ?? 'Untitled').slice(0, 120)
}
