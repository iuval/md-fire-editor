import { describe, expect, it, vi } from 'vitest'
import { MarkdownEmitter } from '../src/lib/editor/markdownEmitter'

function setup(initial: string, idleMs = 400) {
  const serialised: string[] = []
  const emitted: string[] = []
  let current = initial
  const emitter = new MarkdownEmitter({ idleMs, initial })
  emitter.configure({
    // Every call is one full-document serialisation, the thing this class exists
    // to avoid doing once per keystroke.
    serialize: () => {
      serialised.push(current)
      return current
    },
    emit: (markdown) => emitted.push(markdown),
  })
  return {
    emitter,
    emitted,
    serialised,
    set: (next: string) => {
      current = next
    },
  }
}

describe('MarkdownEmitter', () => {
  it('serialises once for a burst of keystrokes', () => {
    vi.useFakeTimers()
    try {
      const { emitter, serialised, emitted, set } = setup('# Nota\n\ncuerpo')
      set('# Nota\n\ncuerpo nuevo')
      emitter.markDirty()
      emitter.markDirty()
      emitter.markDirty()
      expect(serialised).toHaveLength(0)
      vi.advanceTimersByTime(400)
      expect(serialised).toHaveLength(1)
      expect(emitted).toEqual(['# Nota\n\ncuerpo nuevo'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet when the serialised body did not really change', () => {
    vi.useFakeTimers()
    try {
      const { emitter, emitted, set } = setup('# Nota\n\ncuerpo')
      // The serialiser drops the trailing newline: not an edit.
      set('# Nota\n\ncuerpo\n')
      emitter.markDirty()
      vi.advanceTimersByTime(400)
      expect(emitted).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores the transient empty document the editor emits while rebuilding', () => {
    vi.useFakeTimers()
    try {
      const { emitter, emitted, set } = setup('# Nota\n\ncuerpo')
      set('')
      emitter.markDirty()
      vi.advanceTimersByTime(400)
      expect(emitted).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not echo an externally applied change back as an edit', () => {
    vi.useFakeTimers()
    try {
      const { emitter, emitted, set } = setup('# Nota\n\ncuerpo')
      set('# Otra\n\nllegó del agente')
      emitter.adopt('# Otra\n\nllegó del agente')
      emitter.markDirty()
      vi.advanceTimersByTime(400)
      expect(emitted).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending work on dispose, so closing a tab does not lose the last keystrokes', () => {
    const { emitter, emitted, set } = setup('# Nota\n\ncuerpo')
    set('# Nota\n\ncuerpo último')
    emitter.markDirty()
    emitter.dispose()
    expect(emitted).toEqual(['# Nota\n\ncuerpo último'])
  })

  it('does not serialise twice when disposed with nothing pending', () => {
    const { emitter, serialised } = setup('# Nota\n\ncuerpo')
    emitter.dispose()
    expect(serialised).toHaveLength(0)
  })
})
