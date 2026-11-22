import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Loader2 } from 'lucide-react'
import type { ProviderStatus, SyncStats } from '../lib/collab/provider'
import { acquireNoteSession } from '../lib/collab/noteSession'
import type { AwarenessUser, CollabUser } from '../lib/collab/awareness'
import { MAX_MARKDOWN_BYTES, type Note } from '../lib/notes'
import { colorForUid } from '../lib/collab/presenceColors'
import { sameMarkdown } from '../lib/markdown'
import { buildEditorExtensions } from '../lib/editor/extensions'
import { EditorToolbar } from './EditorToolbar'

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
}: CollaborativeEditorProps) {
  const [ready, setReady] = useState(false)
  const [focused, setFocused] = useState(false)
  const changeRef = useRef(onMarkdownChange)
  useEffect(() => {
    changeRef.current = onMarkdownChange
  }, [onMarkdownChange])

  // Last markdown this editor emitted. Anything else arriving on the note
  // document is an external edit (e.g. the agent CLI) and must be applied to
  // the shared Y document so every client converges on it.
  const emittedRef = useRef(body)
  const seedingRef = useRef(true)

  const userInfo: CollabUser = useMemo(
    () => ({ name: userName, color: colorForUid(uid) }),
    [userName, uid]
  )

  // The Yjs document, its Firestore transport and the presence channel come
  // from the shared per-note session, so two panes showing the same note share
  // one document instead of syncing against each other. They exist on the first
  // render because the editor extensions need real instances.
  const owner = useId()
  const [session] = useState(() => acquireNoteSession(note.id, uid, userInfo, owner))

  useEffect(() => () => session.release(owner), [session, owner])

  // Report provider counters periodically so the usage page stays cheap (one
  // write every 30 s at most, never per keystroke).
  useEffect(() => {
    if (!onStats) return
    const tick = () => onStats({ ...session.provider.stats })
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
    () => buildEditorExtensions({ doc: session.doc, awareness: session.awareness, user: userInfo }),
    [session, userInfo]
  )

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: { class: 'md-editor-content', spellcheck: 'true' },
      },
      onCreate: ({ editor: instance }) => {
        seedingRef.current = true
        try {
          const fragment = session.doc.getXmlFragment('content')
          // Only the first view of a note may seed it: the second one renders
          // what the shared document already holds.
          if (session.claimSeed() && fragment.length === 0 && body.trim()) {
            instance.commands.setContent(body)
          }
        } finally {
          const storage = instance.storage as unknown as { markdown: { getMarkdown(): string } }
          emittedRef.current = storage.markdown.getMarkdown()
          seedingRef.current = false
        }
        setReady(true)
      },
      onUpdate: ({ editor: instance }) => {
        const storage = instance.storage as unknown as { markdown: { getMarkdown(): string } }
        const markdown = storage.markdown.getMarkdown()
        // Seeding the document (and applying a remote change) also fires
        // `onUpdate`. Emitting that echo made every *open* bump `updatedAt`,
        // reordering the note inside its folder.
        if (seedingRef.current) {
          emittedRef.current = markdown
          return
        }
        // A transient empty document while we already have content is the editor
        // rebuilding, not the user deleting everything.
        if (!markdown.trim() && emittedRef.current.trim()) return
        if (sameMarkdown(markdown, emittedRef.current)) {
          emittedRef.current = markdown
          return
        }
        emittedRef.current = markdown
        if (markdown.length <= MAX_MARKDOWN_BYTES) changeRef.current(markdown)
      },
    },
    [session, userInfo]
  )

  // Reconcile external writes (agent CLI, another device, an import).
  useEffect(() => {
    if (!editor) return
    const incoming = body ?? ''
    const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } }
    const current = storage.markdown.getMarkdown()
    if (!incoming || incoming === current || incoming === emittedRef.current) return
    emittedRef.current = incoming
    editor.commands.setContent(incoming)
  }, [editor, body])

  useEffect(() => {
    if (!editor) return
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
          <Loader2 size={14} className="spin" /> Conectando…
        </div>
      )}
      {!editable && (
        <p className="readonly-note">Solo lectura</p>
      )}
      <EditorContent editor={editor} />
      {isMobile && editable && editor && <EditorToolbar editor={editor} visible={focused} />}
    </div>
  )
}
