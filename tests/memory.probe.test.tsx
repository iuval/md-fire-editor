/**
 * Memory probe — a measurement harness, not a pass/fail test.
 *
 *   NODE_OPTIONS="--expose-gc" npx vitest run --reporter=verbose --silent=false tests/memory.probe.test.tsx
 *
 * It is deliberately excluded from `npm test` (which lists its files) because
 * the numbers move with the V8 version and the machine: the point is to compare
 * before/after a change, not to assert an absolute budget.
 *
 * Heap numbers are JS heap inside jsdom: string and ProseMirror costs are the
 * real ones, DOM nodes cost extra in a browser (so treat them as a lower bound
 * for the editor and as accurate for the note bodies).
 */
// @vitest-environment jsdom
import { describe, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { buildEditorExtensions } from '../src/lib/editor/extensions'
import { FirestoreAwareness } from '../src/lib/collab/awareness'
import { toNote } from '../src/lib/notes'
import { normalizeMarkdown, sameMarkdown } from '../src/lib/markdown'

const g = globalThis as unknown as { gc?: () => void }
const MB = (b: number) => (b / 1024 / 1024).toFixed(2)
const KB = (b: number) => (b / 1024).toFixed(1)

function heap(): number {
  for (let i = 0; i < 4; i++) g.gc?.()
  return process.memoryUsage().heapUsed
}

const SPANISH =
  'Escribir sin distracciones: la nota se guarda sola mientras el editor mantiene el documento vivo. '

/** Spanish prose (accents included) of exactly `chars` characters. */
function body(chars: number, seed = ''): string {
  let out = `${seed} `
  while (out.length < chars) out += SPANISH
  return out.slice(0, chars)
}

function docMarkdown(kb: number, withTags = false): string {
  const parts: string[] = []
  let size = 0
  let i = 0
  while (size < kb * 1024) {
    const tags = withTags && i % 3 === 0 ? ' #proyecto/alpha #revision #urgente' : ''
    const p = body(220, `Párrafo ${i++} lorem ipsum${tags}`)
    parts.push(`## Sección ${i}\n\n${p}\n`)
    size += p.length + 20
  }
  return parts.join('\n')
}

function makeEditor(markdown: string, ydoc = new Y.Doc()) {
  const awareness = new FirestoreAwareness('n', 'u1', { name: 'Ana', color: '#c25e00' }, ydoc, null)
  const editor = new Editor({
    extensions: buildEditorExtensions({
      doc: ydoc,
      awareness: awareness as never,
      user: { name: 'Ana', color: '#c25e00' },
    }),
  })
  editor.commands.setContent(markdown)
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } }
  return { editor, ydoc, getMarkdown: () => storage.markdown.getMarkdown() }
}

function docData(i: number, chars: number) {
  return {
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own',
    memberIds: ['u1', 'u2', 'u3'],
    roles: { u1: 'owner', u2: 'editor', u3: 'editor' },
    access: 'restricted',
    title: `Nota número ${i}`,
    markdown: body(chars, `n${i}`),
    tags: ['uno', 'dos'],
    order: i,
    version: 1,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 2, nanoseconds: 0 },
  }
}

describe('memory probe', () => {
  it('vault list: with bodies (today) vs metadata-only', () => {
    const COUNT = 300
    const CHARS = 20_000

    const baseCurrent = heap()
    const current = Array.from({ length: COUNT }, (_, i) => toNote(`n${i}`, docData(i, CHARS)))
    const currentCost = heap() - baseCurrent

    const baseMeta = heap()
    const meta = current.map((note) => ({ ...note, markdown: '' }))
    const metaCost = heap() - baseMeta

    const perBody = Buffer.byteLength(current[0].markdown, 'utf16le')
    console.log(
      `[vault] ${COUNT} notes x ${CHARS} chars: current=+${MB(currentCost)}MB, metadata-only=+${MB(metaCost)}MB, ` +
        `saved=${MB(currentCost - metaCost)}MB; per body ${KB(perBody)}KB heap (utf16) for ` +
        `${KB(Buffer.byteLength(current[0].markdown))}KB utf8`
    )
    if (!meta.length) throw new Error('unreachable')
  })

  it('editor cost: by document size, second view, second note', () => {
    const warm = makeEditor(docMarkdown(5))
    warm.editor.destroy()
    warm.ydoc.destroy()
    heap()

    const cost = (md: string, ydoc?: Y.Doc) => {
      const before = heap()
      const instance = makeEditor(md, ydoc)
      return { instance, bytes: heap() - before }
    }

    const e10 = cost(docMarkdown(10))
    const e50 = cost(docMarkdown(50))
    const e100 = cost(docMarkdown(100))
    // A split pane on the same note: shared Y.Doc, second ProseMirror view.
    const view2 = cost('', e100.instance.ydoc)
    // A split pane on another note: independent document.
    const other = cost(docMarkdown(100))
    const e250 = cost(docMarkdown(250))

    console.log(
      `[editor] 10KB=+${MB(e10.bytes)}MB  50KB=+${MB(e50.bytes)}MB  100KB=+${MB(e100.bytes)}MB  ` +
        `250KB (MAX_MARKDOWN_BYTES)=+${MB(e250.bytes)}MB`
    )
    console.log(
      `[editor] 2nd view of the same doc=+${MB(view2.bytes)}MB  2nd note (100KB)=+${MB(other.bytes)}MB`
    )
    for (const item of [e10, e50, e100, e250, other, view2]) {
      item.instance.editor.destroy()
      item.instance.ydoc.destroy()
    }
  })

  it('work done on every keystroke', () => {
    const markdown = docMarkdown(100, true)
    const instance = makeEditor(markdown)
    const n = 100

    // 1. The comparison that runs on every real edit: what the serialiser just
    //    produced (trailing newline dropped) against what was stored. The old
    //    implementation normalised both strings; that is still here as the
    //    reference point.
    const padded = `${markdown}\n\n`
    const edited = `${markdown.slice(0, 50_000)}x${markdown.slice(50_000)}`
    const before = heap()
    const t0 = performance.now()
    let same = false
    for (let i = 0; i < n; i++) same = sameMarkdown(markdown, padded)
    const t1 = performance.now()
    for (let i = 0; i < n; i++) same = sameMarkdown(markdown, edited)
    const t2 = performance.now()
    for (let i = 0; i < n; i++) {
      same = normalizeMarkdown(markdown) === normalizeMarkdown(padded)
    }
    const t2b = performance.now()
    const after = heap()

    // 2. Serialisation is no longer on the keystroke path: it happens once per
    //    burst (MarkdownEmitter), measured separately below.
    const t3 = performance.now()
    let out = ''
    for (let i = 0; i < n; i++) out = instance.getMarkdown()
    const t4 = performance.now()

    // 3. Tag decorations: plugin state means a selection-only transaction (caret
    //    move, or a peer's presence update) reuses the set instead of rescanning.
    const plugins = (instance.editor.view as unknown as { state: { plugins: unknown[] } }).state.plugins as {
      key: string
      spec: { props?: { decorations?: (state: unknown) => { find(): unknown[] } } }
    }[]
    const tagPlugin = plugins.find((plugin) => String(plugin.key).startsWith('tagHighlight'))
    const decorations = tagPlugin?.spec.props?.decorations
    const state = instance.editor.state
    const t5 = performance.now()
    let pills = 0
    for (let i = 0; i < n; i++) pills = decorations?.(state)?.find().length ?? -1
    const t6 = performance.now()

    console.log(
      `[keystroke] compare ${((t1 - t0) / n).toFixed(3)}ms (trailing whitespace) / ` +
        `${((t2 - t1) / n).toFixed(3)}ms (one char in the middle) vs ` +
        `${((t2b - t2) / n).toFixed(3)}ms normalising both copies (the old way); ` +
        `heap drift +${MB(after - before)}MB; same=${same}`
    )
    console.log(
      `[keystroke] getMarkdown (now once per burst, not per keystroke) ` +
        `${((t4 - t3) / n).toFixed(2)}ms + ${KB(out.length * 2)}KB per call`
    )
    console.log(
      `[keystroke] tag decorations on a selection update ${((t6 - t5) / n).toFixed(3)}ms (${pills} pills, reused)`
    )
    instance.editor.destroy()
    instance.ydoc.destroy()
  })
})
