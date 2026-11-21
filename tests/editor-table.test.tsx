// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { buildEditorExtensions } from '../src/lib/editor/extensions'
import { FirestoreAwareness } from '../src/lib/collab/awareness'

const TABLE = [
  '| pieza | costo | nota |',
  '|---|---|---|',
  '| manifiesto | 1 lectura | snapshot |',
  '| update | 1 escritura | hash verificado |',
].join('\n')

function makeEditor() {
  const doc = new Y.Doc()
  const element = document.createElement('div')
  const awareness = new FirestoreAwareness('n1', 'u1', { name: 'Ana', color: '#c25e00' }, doc, null)
  const editor = new Editor({
    element,
    extensions: buildEditorExtensions({ doc, awareness, user: { name: 'Ana', color: '#c25e00' } }),
  })
  return { editor, element }
}

function markdownOf(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

let editors: Editor[] = []
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
  document.body.innerHTML = ''
})

describe('GFM tables', () => {
  it('parses a table into real table nodes instead of flattening the text', () => {
    const { editor, element } = makeEditor()
    editors.push(editor)

    editor.commands.setContent(TABLE)

    expect(element.querySelectorAll('table')).toHaveLength(1)
    expect(element.querySelectorAll('th')).toHaveLength(3)
    expect(element.querySelectorAll('td')).toHaveLength(6)
    // The old failure mode was one paragraph holding every cell: "piezacosto…".
    // Assert the cells are real cells, not a glued string.
    expect([...element.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'manifiesto',
      '1 lectura',
      'snapshot',
      'update',
      '1 escritura',
      'hash verificado',
    ])
  })

  it('serializes a table back to markdown byte-for-byte', () => {
    const { editor } = makeEditor()
    editors.push(editor)

    editor.commands.setContent(TABLE)
    const first = markdownOf(editor).trim()

    editor.commands.setContent(first)
    const second = markdownOf(editor).trim()

    expect(first).toContain('| pieza | costo | nota |')
    expect(first).toContain('| manifiesto | 1 lectura | snapshot |')
    expect(second).toBe(first)
  })

  it('keeps inline marks, code and links inside cells', () => {
    const { editor, element } = makeEditor()
    editors.push(editor)

    editor.commands.setContent('| a | b |\n|---|---|\n| **x** y | `code` |\n| [e](http://e.com) | 2 |')

    expect(element.querySelectorAll('td')).toHaveLength(4)
    expect(element.querySelector('td strong')).not.toBeNull()
    expect(element.querySelector('td code')).not.toBeNull()
    const out = markdownOf(editor)
    expect(out).toContain('**x** y')
    expect(out).toContain('`code`')
    expect(out).toContain('[e](http://e.com)')
  })
})
