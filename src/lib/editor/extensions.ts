import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import type { Extensions } from '@tiptap/core'
import type * as Y from 'yjs'
import { TagHighlight } from '../../components/extensions/tagHighlight'
import type { CollabUser } from '../collab/awareness'

/** The subset of y-protocols Awareness that CollaborationCaret talks to. */
interface AwarenessLike {
  clientID: number
  getLocalState(): Record<string, unknown> | null
  setLocalStateField(field: string, value: unknown): void
  getStates(): Map<number, Record<string, unknown>>
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
}

const caretRender = (user: { name?: string; color?: string }) => {
  const cursor = document.createElement('span')
  cursor.className = 'collaboration-caret'
  cursor.style.borderLeft = `2px solid ${user.color ?? '#c25e00'}`
  const label = document.createElement('span')
  label.textContent = user.name ?? 'Anónimo'
  label.style.cssText = `background:${user.color ?? '#c25e00'};color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;position:absolute;top:-16px;left:-2px;white-space:nowrap;`
  cursor.appendChild(label)
  return cursor
}

/**
 * The editor schema, in one place: the component and the round-trip tests must
 * run the exact same extensions or a test can pass while the app still eats a
 * table.
 */
export function buildEditorExtensions(options: {
  doc: Y.Doc
  awareness: AwarenessLike
  user: CollabUser
  placeholder?: string
}): Extensions {
  return [
    StarterKit.configure({ undoRedo: false }),
    Collaboration.configure({ document: options.doc, field: 'content' }),
    CollaborationCaret.configure({
      provider: { awareness: options.awareness },
      user: options.user,
      render: caretRender,
    }),
    // Tables are the one block that silently destroyed content before: without
    // these nodes a GFM table is flattened into a paragraph on load and the
    // flattened text is what gets written back.
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder: options.placeholder ?? 'Empezá a escribir…' }),
    TagHighlight,
    Markdown.configure({ html: false, transformPastedText: true }),
  ]
}
