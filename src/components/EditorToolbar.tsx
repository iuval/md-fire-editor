import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Bold, Heading1, Heading2, Italic, List, Quote } from 'lucide-react'
import { useT } from '../i18n/index.ts'

interface EditorToolbarProps {
  editor: Editor
  /** Hide the bar until the editor has focus: chrome appears when you type. */
  visible: boolean
}

/**
 * Touch has no `#`, `**` or `-` key, so on a phone the markdown shortcuts are
 * unreachable. This is the smallest set of actions that covers real writing,
 * and it only exists while the editor is focused.
 */
export function EditorToolbar({ editor, visible }: EditorToolbarProps) {
  const t = useT()
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bullet: e.isActive('bulletList'),
      quote: e.isActive('blockquote'),
    }),
  })

  const actions = [
    {
      label: t('editor.heading1'),
      on: active?.h1,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      icon: <Heading1 size={17} />,
    },
    {
      label: t('editor.heading2'),
      on: active?.h2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      icon: <Heading2 size={17} />,
    },
    {
      label: t('editor.bold'),
      on: active?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
      icon: <Bold size={17} />,
    },
    {
      label: t('editor.italic'),
      on: active?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
      icon: <Italic size={17} />,
    },
    {
      label: t('editor.list'),
      on: active?.bullet,
      run: () => editor.chain().focus().toggleBulletList().run(),
      icon: <List size={17} />,
    },
    {
      label: t('editor.quote'),
      on: active?.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
      icon: <Quote size={17} />,
    },
  ]

  return (
    <div className={`editor-toolbar${visible ? ' is-visible' : ''}`} role="toolbar" aria-label={t('editor.toolbar')}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="editor-toolbar-btn"
          aria-label={action.label}
          aria-pressed={!!action.on}
          // Without this the editor blurs on touch, the keyboard closes, and
          // the command applies to a dead selection.
          onMouseDown={(event) => event.preventDefault()}
          onClick={action.run}
        >
          {action.icon}
        </button>
      ))}
    </div>
  )
}
