import { createNote, saveNoteContent } from './notes'
import { guestDraftTitle, type GuestDraft } from './guestDraft'

/**
 * The only cloud path the guest draft has: create a real note and write the
 * body. It is a plain function with injectable dependencies so the unit tests
 * can assert the contract without a Firestore emulator.
 */
export interface GuestMigrationDeps {
  createNote: typeof createNote
  saveNoteContent: typeof saveNoteContent
}

export async function migrateGuestDraft(
  uid: string,
  draft: GuestDraft,
  deps: GuestMigrationDeps = { createNote, saveNoteContent }
): Promise<string> {
  const note = await deps.createNote(uid)
  await deps.saveNoteContent(note.id, {
    title: guestDraftTitle(draft),
    markdown: draft.markdown,
    version: 1,
  })
  return note.id
}
