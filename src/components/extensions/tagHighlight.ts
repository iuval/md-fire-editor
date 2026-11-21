import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Same shape as src/lib/tags.ts: `#tag`, preceded by whitespace or punctuation. */
const TAG_RE = /(^|[\s([{,;:'"])#([\p{L}\p{N}_/-]+)/gu

/**
 * Renders `#tag` as a pill inside the editor, like Obsidian.
 *
 * Decorations are view-only, so they never enter the Yjs document and cannot
 * disturb collaboration: they are recomputed from the text on every change.
 */
export const TagHighlight = Extension.create({
  name: 'tagHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tagHighlight'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos, parent) => {
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

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
