import { describe, expect, it, vi } from 'vitest'
import {
  GUEST_DRAFT_KEY,
  clearGuestDraft,
  guestDraftTitle,
  isMigratable,
  readGuestDraft,
  writeGuestDraft,
  type GuestDraft,
} from '../src/lib/guestDraft'
import { migrateGuestDraft } from '../src/lib/guestMigration'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

const draft: GuestDraft = {
  title: 'Ideas',
  markdown: '# Ideas\n\nUna nota de prueba.',
  savedAt: 1_700_000_000_000,
}

describe('guest draft storage', () => {
  it('round-trips a draft', () => {
    const store = memoryStorage()
    expect(writeGuestDraft(draft, store)).toBe(true)
    expect(readGuestDraft(store)).toEqual(draft)
  })

  it('clamps the title to 120 characters', () => {
    const store = memoryStorage()
    writeGuestDraft({ ...draft, title: 'x'.repeat(200) }, store)
    expect(readGuestDraft(store)?.title).toHaveLength(120)
  })

  it('ignores corrupt or foreign values', () => {
    const store = memoryStorage()
    store.setItem(GUEST_DRAFT_KEY, '{not json')
    expect(readGuestDraft(store)).toBeNull()
    store.setItem(GUEST_DRAFT_KEY, JSON.stringify({ title: 1, markdown: [] }))
    expect(readGuestDraft(store)).toBeNull()
  })

  it('clears the draft', () => {
    const store = memoryStorage()
    writeGuestDraft(draft, store)
    clearGuestDraft(store)
    expect(readGuestDraft(store)).toBeNull()
  })

  it('treats a whitespace-only body as not migratable', () => {
    expect(isMigratable({ ...draft, markdown: '   \n ' })).toBe(false)
    expect(isMigratable(null)).toBe(false)
    expect(isMigratable(draft)).toBe(true)
  })
})

describe('guest draft title', () => {
  it('uses the explicit title first', () => {
    expect(guestDraftTitle(draft)).toBe('Ideas')
  })

  it('falls back to the first meaningful line of the body', () => {
    expect(guestDraftTitle({ ...draft, title: '  ', markdown: '\n\n## Título\nTexto' })).toBe(
      'Título'
    )
  })

  it('uses a neutral title when the body is empty', () => {
    expect(guestDraftTitle({ ...draft, title: '', markdown: '' })).toBe('Untitled')
  })
})

describe('guest draft migration', () => {
  it('creates a note and writes the draft body', async () => {
    const createNote = vi.fn(async () => ({ id: 'note-1' }))
    const saveNoteContent = vi.fn(async () => undefined)

    await migrateGuestDraft('uid-1', draft, {
      createNote: createNote as never,
      saveNoteContent: saveNoteContent as never,
    })

    expect(createNote).toHaveBeenCalledWith('uid-1')
    expect(saveNoteContent).toHaveBeenCalledWith('note-1', {
      title: 'Ideas',
      markdown: draft.markdown,
      version: 1,
    })
  })
})
