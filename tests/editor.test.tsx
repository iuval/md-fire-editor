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
import { TagHighlight, tagHighlightKey } from '../src/components/extensions/tagHighlight'
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

    // A selection-only transaction must reuse the pill set: rebuilding it on
    // every caret move (and on every presence update from a peer) was ~1 ms and
    // ~430 objects per keystroke on a 100 KB note.
    const before = tagHighlightKey.getState(editor.state)
    expect(before?.find().length).toBe(2)
    editor.commands.setTextSelection(1)
    expect(tagHighlightKey.getState(editor.state)).toBe(before)

    // Typing a new tag does rebuild it, and picks the new pill up.
    editor.commands.insertContentAt(editor.state.doc.content.size, ' #nuevo')
    expect(Array.from(element.querySelectorAll('.tag-pill')).map((el) => el.textContent)).toEqual([
      '#Trabajo',
      '#clientes/acme',
      '#nuevo',
    ])

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
          body={note.markdown}
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
      body: '# Original\n\ncontenido viejo',
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
          body={'# Actualizado por el agente\n\ncontenido nuevo'}
        />
      )
      await Promise.resolve()
    })

    const text = container.querySelector('.ProseMirror')?.textContent ?? ''
    expect(text).toContain('Actualizado por el agente')
    expect(text).toContain('contenido nuevo')
    expect(text).not.toContain('contenido viejo')
  })

  it('puts the caret in the body when the title asks for it', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const props = {
      note: { ...note, markdown: '# Hola' },
      body: '# Hola',
      uid: 'u1',
      userName: 'Ana',
      editable: true,
      onMarkdownChange: () => undefined,
      onPresence: () => undefined,
      onStatus: () => undefined,
    }

    await act(async () => {
      root.render(<CollaborativeEditor {...props} focusSignal={0} />)
    })
    const surface = container.querySelector('.md-editor-content')!
    expect(surface.contains(document.activeElement)).toBe(false)

    // Enter on the title: the caret goes to the top of the body.
    await act(async () => {
      root.render(<CollaborativeEditor {...props} focusSignal={1} />)
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(surface.contains(document.activeElement)).toBe(true)
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
          body={note.markdown}
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

    expect(container.textContent).toContain('Read only')
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
  })
})

describe('frontmatter is never handed to the editor', () => {
  it('keeps properties alive when the body round-trips', async () => {
    const { splitFrontmatter, joinFrontmatter } = await import('../src/lib/markdown')
    const { parseProperties } = await import('../src/lib/properties')
    const { extractTags } = await import('../src/lib/tags')

    const full = '---\ntags: [proyecto]\nestado: en curso\nvence: 2026-12-01\n---\n\n# Nota\n\ncuerpo #idea\n'
    const { frontmatter, body } = splitFrontmatter(full)

    // What the editor sees and what it gives back after an edit.
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
    editor.commands.setContent(body)
    editor.commands.insertContent(' más')
    const emitted = (editor.storage as any).markdown.getMarkdown() as string

    const saved = joinFrontmatter(frontmatter, emitted)

    expect(parseProperties(saved)).toEqual([
      { key: 'estado', type: 'text', value: 'en curso' },
      { key: 'vence', type: 'date', value: '2026-12-01' },
    ])
    expect(extractTags(saved)).toEqual(['idea', 'proyecto'])
    expect(saved).toContain('más')

    editor.destroy()
    ydoc.destroy()
  })
})
