import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { TagHighlight } from './extensions/tagHighlight'
import * as Y from 'yjs'
import { Loader2 } from 'lucide-react'
import { FirestoreYjsProvider, type ProviderStatus, type SyncStats } from '../lib/collab/provider'
import { FirestoreAwareness, type AwarenessUser, type CollabUser } from '../lib/collab/awareness'
import { MAX_MARKDOWN_BYTES, type Note } from '../lib/notes'
import { colorForUid } from '../lib/collab/presenceColors'

interface CollaborativeEditorProps {
  note: Note
  uid: string
  userName: string
  editable: boolean
  onMarkdownChange: (markdown: string) => void
  onPresence: (users: AwarenessUser[]) => void
  onStatus: (status: ProviderStatus) => void
  onStats?: (stats: SyncStats) => void
}

export function CollaborativeEditor({
  note,
  uid,
  userName,
  editable,
  onMarkdownChange,
  onPresence,
  onStatus,
  onStats,
}: CollaborativeEditorProps) {
  const [ready, setReady] = useState(false)
  const changeRef = useRef(onMarkdownChange)
  useEffect(() => {
    changeRef.current = onMarkdownChange
  }, [onMarkdownChange])

  // Last markdown this editor emitted. Anything else arriving on the note
  // document is an external edit (e.g. the agent CLI) and must be applied to
  // the shared Y document so every client converges on it.
  const emittedRef = useRef(note.markdown)

  const userInfo: CollabUser = useMemo(
    () => ({ name: userName, color: colorForUid(uid) }),
    [userName, uid]
  )

  // The Yjs document, its Firestore transport and the presence channel are all
  // created together so the editor extensions receive real instances on the
  // first render (refs would still be empty at that point).
  const session = useMemo(() => {
    const doc = new Y.Doc()
    return {
      doc,
      provider: new FirestoreYjsProvider(note.id, doc),
      awareness: new FirestoreAwareness(note.id, uid, userInfo, doc),
    }
  }, [note.id, uid, userInfo])

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
    session.provider.connect()
    session.awareness.connect()

    return () => {
      offUsers()
      offStatus()
      session.awareness.destroy()
      session.provider.destroy()
      session.doc.destroy()
    }
  }, [session, onPresence, onStatus])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: session.doc, field: 'content' }),
        CollaborationCaret.configure({
          provider: { awareness: session.awareness },
          user: userInfo,
          render: (user: { name?: string; color?: string }) => {
            const cursor = document.createElement('span')
            cursor.className = 'collaboration-caret'
            cursor.style.borderLeft = `2px solid ${user.color ?? '#c25e00'}`
            const label = document.createElement('span')
            label.textContent = user.name ?? 'Anónimo'
            label.style.cssText = `background:${user.color ?? '#c25e00'};color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;position:absolute;top:-16px;left:-2px;white-space:nowrap;`
            cursor.appendChild(label)
            return cursor
          },
        }),
        Placeholder.configure({ placeholder: 'Empezá a escribir…' }),
        TagHighlight,
        Markdown.configure({ html: false, transformPastedText: true }),
      ],
      editorProps: {
        attributes: { class: 'md-editor-content', spellcheck: 'true' },
      },
      onCreate: ({ editor: instance }) => {
        const fragment = session.doc.getXmlFragment('content')
        if (fragment.length === 0 && note.markdown.trim()) {
          instance.commands.setContent(note.markdown)
        }
        setReady(true)
      },
      onUpdate: ({ editor: instance }) => {
        const storage = instance.storage as unknown as { markdown: { getMarkdown(): string } }
        const markdown = storage.markdown.getMarkdown()
        emittedRef.current = markdown
        if (markdown.length <= MAX_MARKDOWN_BYTES) changeRef.current(markdown)
      },
    },
    [session, userInfo]
  )

  // Reconcile external writes (agent CLI, another device, an import).
  useEffect(() => {
    if (!editor) return
    const incoming = note.markdown ?? ''
    const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } }
    const current = storage.markdown.getMarkdown()
    if (!incoming || incoming === current || incoming === emittedRef.current) return
    emittedRef.current = incoming
    editor.commands.setContent(incoming)
  }, [editor, note.markdown])

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
    <div style={{ position: 'relative' }}>
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
    </div>
  )
}
