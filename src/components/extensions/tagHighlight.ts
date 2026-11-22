import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** Same shape as src/lib/tags.ts: `#tag`, preceded by whitespace or punctuation. */
const TAG_RE = /(^|[\s([{,;:'"])#([\p{L}\p{N}_/-]+)/gu

/** Test seam: lets a test assert that the pill set is reused, not rebuilt. */
export const tagHighlightKey = new PluginKey<DecorationSet>('tagHighlight')

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return
    if (node.marks.some((mark) => mark.type.name === 'code')) return
    if (parent?.type.name === 'codeBlock') return

    for (const match of node.text.matchAll(TAG_RE)) {
      const prefix = match[1]?.length ?? 0
      const start = pos + (match.index ?? 0) + prefix
      const end = start + match[0].length - prefix
      decorations.push(Decoration.inline(start, end, { class: 'tag-pill' }))
    }
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * Renders `#tag` as a pill inside the editor, like Obsidian.
 *
 * Decorations are view-only, so they never enter the Yjs document and cannot
 * disturb collaboration. They are kept as plugin state instead of being rebuilt
 * by the `decorations` prop: that prop runs on **every** transaction, so moving
 * the caret or watching a peer's cursor (a presence-only update, dozens per
 * keystroke of the other person) used to rescan the whole document — around
 * 1 ms and ~430 decoration objects on a 100 KB note each time. Now the set is
 * built once per document change and reused for everything else.
 */
export const TagHighlight = Extension.create({
  name: 'tagHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: tagHighlightKey,
        state: {
          init: (_config, state: EditorState) => buildDecorations(state.doc),
          // Rebuild only when the text changed: a caret move, a selection or a
          // peer's presence update leaves the document (and the pills) alone.
          apply: (tr: Transaction, previous: DecorationSet) =>
            tr.docChanged ? buildDecorations(tr.doc) : previous,
        },
        props: {
          decorations(state: EditorState) {
            return tagHighlightKey.getState(state) ?? null
          },
        },
      }),
    ]
  },
})
