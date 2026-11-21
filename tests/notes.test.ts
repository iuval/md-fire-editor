import { describe, expect, it } from 'vitest'
import { MAX_TITLE_LENGTH, buildNoteUpdate } from '../src/lib/notes'

describe('note patches', () => {
  it('never writes a field the caller did not send', () => {
    // Regression: saving markdown used to write `title: ''`, wiping the title one
    // second after a note was opened.
    const update = buildNoteUpdate({ markdown: 'hola', tags: ['x'], version: 4 })

    expect(update).toEqual({ markdown: 'hola', tags: ['x'], version: 4 })
    expect('title' in update).toBe(false)
  })

  it('keeps markdown and tags untouched when only the title changes', () => {
    const update = buildNoteUpdate({ title: 'Nuevo' })
    expect(update).toEqual({ title: 'Nuevo' })
    expect('markdown' in update).toBe(false)
    expect('tags' in update).toBe(false)
  })

  it('truncates long titles and accepts an explicit empty title', () => {
    expect(buildNoteUpdate({ title: 'a'.repeat(400) }).title).toHaveLength(MAX_TITLE_LENGTH)
    expect(buildNoteUpdate({ title: '' })).toEqual({ title: '' })
  })

  it('handles a patch with only tags (property edits)', () => {
    expect(buildNoteUpdate({ tags: [] })).toEqual({ tags: [] })
  })
})
