// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Markdown } from 'tiptap-markdown'
import { CollaborativeEditor } from '../src/components/CollaborativeEditor'
import { TagHighlight } from '../src/components/extensions/tagHighlight'
import { FirestoreAwareness } from '../src/lib/collab/awareness'
import type { Note } from '../src/lib/notes'

const note: Note = {
  id: 'n1',
  ownerId: 'u1',
  memberIds: ['u1'],
  roles: { u1: 'owner' },
  access: 'restricted',
  title: 'Demo',
  markdown: '# Título\n\nTexto **inicial**',
  version: 1,
}

/** Deletes without touching the global playwright/jsdom instance. */
function fakeAwareness() {
  const ydoc = new Y.Doc()
  return new FirestoreAwareness('n1', 'u1', { name: 'Ana', color: '#c25e00' }, ydoc, null)
}

let roots: Root[] = []

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()))
  roots = []
  document.body.innerHTML = ''
})

describe('inline tag rendering', () => {
  it('turns #tags into pills without touching code', () => {
    const ydoc = new Y.Doc()
    const awareness = fakeAwareness()
    const element = document.createElement('div')

    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc, field: 'content' }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name: 'Ana' } }),
        TagHighlight,
        Markdown.configure({ html: false }),
      ],
    })

    editor.commands.setContent('texto #Trabajo y #clientes/acme\n\n```\n#no-es-tag\n```')

    const pills = Array.from(element.querySelectorAll('.tag-pill')).map((el) => el.textContent)
    expect(pills).toEqual(['#Trabajo', '#clientes/acme'])

    editor.destroy()
    ydoc.destroy()
  })
})

describe('Tiptap + Yjs + Markdown wiring', () => {
  it('seeds the shared Y document from stored markdown and serializes back', () => {
    const ydoc = new Y.Doc()
    const awareness = fakeAwareness()
    const element = document.createElement('div')

    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc, field: 'content' }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name: 'Ana' } }),
        Markdown.configure({ html: false }),
      ],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = editor.storage as any

    if (ydoc.getXmlFragment('content').length === 0) {
      editor.commands.setContent(note.markdown)
    }

    const markdown = storage.markdown.getMarkdown() as string
    expect(markdown).toContain('# Título')
    expect(markdown).toContain('**inicial**')
    expect(ydoc.getXmlFragment('content').length).toBeGreaterThan(0)

    editor.destroy()
    ydoc.destroy()
  })

  it('reflects edits made directly on the Y document (as a remote client would)', () => {
    const ydoc = new Y.Doc()
    const awareness = fakeAwareness()
    const element = document.createElement('div')

    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc, field: 'content' }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name: 'Ana' } }),
        Markdown.configure({ html: false }),
      ],
    })
    editor.commands.setContent('Hola')
    expect(editor.getText().trim()).toBe('Hola')

    editor.commands.insertContent(' mundo')
    expect(editor.getText().trim()).toBe('Hola mundo')

    editor.destroy()
    ydoc.destroy()
  })
})

describe('<CollaborativeEditor />', () => {
  it('mounts without network access and renders the editor surface', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <CollaborativeEditor
          note={note}
          uid="u1"
          userName="Ana"
          editable
          onMarkdownChange={() => undefined}
          onPresence={() => undefined}
          onStatus={() => undefined}
        />
      )
      await Promise.resolve()
    })

    const surface = container.querySelector('.ProseMirror')
    expect(surface).not.toBeNull()
    expect(container.querySelector('.md-editor-content')).not.toBeNull()
  })

  it('applies external markdown edits to the shared document', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const props = {
      note: { ...note, markdown: '# Original\n\ncontenido viejo' },
      uid: 'u1',
      userName: 'Ana',
      editable: true,
      onMarkdownChange: () => undefined,
      onPresence: () => undefined,
      onStatus: () => undefined,
    }

    await act(async () => {
      root.render(<CollaborativeEditor {...props} />)
      await Promise.resolve()
    })
    expect(container.querySelector('.ProseMirror')?.textContent).toContain('Original')

    // The agent CLI rewrote the note document behind our back.
    await act(async () => {
      root.render(
        <CollaborativeEditor
          {...props}
          note={{ ...props.note, markdown: '# Actualizado por el agente\n\ncontenido nuevo', version: 9 }}
        />
      )
      await Promise.resolve()
    })

    const text = container.querySelector('.ProseMirror')?.textContent ?? ''
    expect(text).toContain('Actualizado por el agente')
    expect(text).toContain('contenido nuevo')
    expect(text).not.toContain('contenido viejo')
  })

  it('renders read-only when the user cannot edit', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <CollaborativeEditor
          note={{ ...note, access: 'restricted' }}
          uid="stranger"
          userName="Otra persona"
          editable={false}
          onMarkdownChange={() => undefined}
          onPresence={() => undefined}
          onStatus={() => undefined}
        />
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Solo lectura')
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
  })
})
