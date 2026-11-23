import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Loader2 } from 'lucide-react'
import { useT } from '../i18n/index.ts'
import type { ProviderStatus, SyncStats } from '../lib/collab/provider'
import { acquireNoteSession } from '../lib/collab/noteSession'
import type { AwarenessUser, CollabUser } from '../lib/collab/awareness'
import { MAX_MARKDOWN_BYTES, type Note } from '../lib/notes'
import { colorForUid } from '../lib/collab/presenceColors'
import { buildEditorExtensions } from '../lib/editor/extensions'
import { MarkdownEmitter } from '../lib/editor/markdownEmitter'
import { EditorToolbar } from './EditorToolbar'

/** The editor's own markdown serialiser (tiptap-markdown). */
type MarkdownStorage = { markdown: { getMarkdown(): string } }

export function markdownOf(editor: Editor | null): string {
  // A destroyed editor keeps its object but loses its storage (`destroy()` resets
  // `extensionStorage` to `{}`), so `storage.markdown` is undefined and this used
  // to throw. Tiptap's React adapter destroys on a 1 ms timer, and a parent state
  // update landing inside that window re-runs the effects below with the dead
  // instance — which is exactly what a visitor's first frame does: the seed opens
  // two tabs, so the pane's editor unmounts while the body is still arriving.
  if (!editor || editor.isDestroyed) return ''
  const storage = (editor.storage as unknown as Partial<MarkdownStorage>).markdown
  if (!storage) return ''
  return storage.getMarkdown()
}

interface CollaborativeEditorProps {
  note: Note
  /** Markdown body without the frontmatter (the editor must not see it). */
  body: string
  uid: string
  userName: string
  editable: boolean
  onMarkdownChange: (markdown: string) => void
  onPresence: (users: AwarenessUser[]) => void
  onStatus: (status: ProviderStatus) => void
  onStats?: (stats: SyncStats) => void
  /** Phones get a formatting bar, since there are no markdown keys. */
  isMobile?: boolean
  /**
   * A visitor's draft: same editor, no Firestore document behind it. The
   * document lives in memory and the body is persisted by the caller.
   */
  local?: boolean
  /** Overrides the empty-document placeholder (the visitor's welcome text). */
  placeholder?: string
  /**
   * Bumped when the body has to take the caret — Enter on the title, the way
   * Obsidian moves from a note's name to its first line. Every other change of
   * this number is a fresh request; 0 means "never asked".
   */
  focusSignal?: number
}

export function CollaborativeEditor({
  note,
  body,
  uid,
  userName,
  editable,
  onMarkdownChange,
  onPresence,
  onStatus,
  onStats,
  isMobile = false,
  local = false,
  placeholder,
  focusSignal = 0,
}: CollaborativeEditorProps) {
  const t = useT()
  const [focused, setFocused] = useState(false)
  const changeRef = useRef(onMarkdownChange)
  useEffect(() => {
    changeRef.current = onMarkdownChange
  }, [onMarkdownChange])

  // Serialising the editor back to markdown costs a copy of the body (0,55 ms for
  // 100 KB), so it happens once per burst of typing instead of once per
  // keystroke. The emitter also remembers what this editor already said: anything
  // else arriving on the note document is an external edit (the agent CLI,
  // another device) and must be applied to the shared Y document so every client
  // converges on it.
  const [emitter] = useState(() => new MarkdownEmitter({ initial: body }))

  useEffect(() => () => emitter.dispose(), [emitter])

  const userInfo: CollabUser = useMemo(
    () => ({ name: userName, color: colorForUid(uid) }),
    [userName, uid]
  )

  // The Yjs document, its Firestore transport and the presence channel come
  // from the shared per-note session, so two panes showing the same note share
  // one document instead of syncing against each other. They exist on the first
  // render because the editor extensions need real instances.
  const owner = useId()
  const [session] = useState(() => acquireNoteSession(note.id, uid, userInfo, owner, local))

  useEffect(() => () => session.release(owner), [session, owner])

  // Report provider counters periodically so the usage page stays cheap (one
  // write every 30 s at most, never per keystroke).
  useEffect(() => {
    if (!onStats) return
    const tick = () => onStats({ ...session.stats })
    tick()
    const timer = setInterval(tick, 30_000)
    return () => {
      clearInterval(timer)
      tick()
    }
  }, [session, onStats])

  useEffect(() => {
    const offStatus = session.provider.onStatus(onStatus)
    const offUsers = session.awareness.onUserChange(onPresence)
    return () => {
      offUsers()
      offStatus()
    }
  }, [session, onPresence, onStatus])

  const extensions = useMemo(
    () =>
      buildEditorExtensions({
        doc: session.doc,
        awareness: session.awareness,
        user: userInfo,
        placeholder,
      }),
    [session, userInfo, placeholder]
  )

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: { class: 'md-editor-content', spellcheck: 'true' },
      },
      onCreate: ({ editor: instance }) => {
        emitter.configure({
          serialize: () => markdownOf(instance),
          emit: (markdown) => {
            if (markdown.length <= MAX_MARKDOWN_BYTES) changeRef.current(markdown)
          },
        })
        const fragment = session.doc.getXmlFragment('content')
        // Only the first view of a note may seed it: the second one renders
        // what the shared document already holds.
        if (session.claimSeed(owner) && fragment.length === 0 && body.trim()) {
          instance.commands.setContent(body)
        }
        // Seeding fires `update` too. Emitting that echo made every *open* bump
        // `updatedAt`, reordering the note inside its folder.
        emitter.adopt(markdownOf(instance))
      },
      onUpdate: ({ transaction }) => {
        // A Yjs-originated change comes from another view (a split showing the
        // same note) or another device. Writing it back would duplicate the save
        // and, between two views, ping-pong the same content forever.
        if (isChangeOrigin(transaction)) return
        emitter.markDirty()
      },
    },
    [session, userInfo]
  )

  // `useEditor` builds the instance in a `useState` initialiser, so `onCreate`
  // fires during render — setting state from there warns ("update on a component
  // that hasn't mounted yet"). "Ready" is just "the instance exists", so derive
  // it: no render-phase update, no extra commit.
  const ready = Boolean(editor)

  // Reconcile external writes (agent CLI, another device, an import). The
  // shared document has one writer: if every view applied the note's markdown,
  // two panes showing the same note would insert it twice.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !session.isPrimary(owner)) return
    const incoming = body ?? ''
    const current = markdownOf(editor)
    if (!incoming || incoming === current) return
    // Adopt before applying: the `update` this triggers must not look like a
    // local edit (it would be written straight back).
    emitter.adopt(incoming)
    editor.commands.setContent(incoming)
  }, [editor, body, emitter, session, owner])

  useEffect(() => {
    if (!focusSignal || !ready || !editor || editor.isDestroyed || !editable) return
    // `start`: the caret lands at the top of the body, not after the last word.
    editor.commands.focus('start', { scrollIntoView: false })
  }, [editor, editable, focusSignal, ready])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(editable)
    editor.setOptions({
      editorProps: {
        attributes: {
          class: 'md-editor-content',
          spellcheck: 'true',
          'aria-readonly': editable ? 'false' : 'true',
        },
      },
    })
  }, [editor, editable])

  return (
    // React's onFocus/onBlur are focusin/focusout, so they still fire when
    // Tiptap recreates the editable node after a `setOptions` call.
    <div
      style={{ position: 'relative' }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
            fontSize: 12.5,
            pointerEvents: 'none',
          }}
        >
          <Loader2 size={14} className="spin" /> {t('editor.connecting')}
        </div>
      )}
      {!editable && (
        <p className="readonly-note">{t('editor.readOnly')}</p>
      )}
      <EditorContent editor={editor} />
      {isMobile && editable && editor && <EditorToolbar editor={editor} visible={focused} />}
    </div>
  )
}
