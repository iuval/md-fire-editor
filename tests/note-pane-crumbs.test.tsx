// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Folder, Note } from '../src/lib/notes'
import type { PaneLeaf } from '../src/lib/panes'

// The canvas surface and the collaborative editor are the note's body, not its
// header: mounting them would need a Firestore session and a ProseMirror.
vi.mock('../src/components/CanvasEditor', () => ({
  CanvasEditor: () => <div data-testid="canvas-surface" />,
}))
vi.mock('../src/components/CollaborativeEditor', () => ({
  CollaborativeEditor: ({ focusSignal }: { focusSignal?: number }) => (
    <div data-testid="markdown-body" data-focus={focusSignal ?? 0} />
  ),
}))

const { NotePane } = await import('../src/components/NotePane')

let roots: Root[] = []

function mount(ui: React.ReactNode) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()))
  roots = []
  document.body.innerHTML = ''
})

function folder(id: string, name: string, parentId: string | null = null): Folder {
  return {
    id,
    ownerId: 'u1',
    name,
    parentId,
    order: 0,
    tags: [],
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
  }
}

const folders = [
  folder('vault', 'ObsidianVault'),
  folder('g', 'GUIONES', 'vault'),
  folder('lm', 'Los Muchachos - Feature Film', 'g'),
]

function note(kind: Note['kind'], body: string): Note {
  return {
    id: 'n1',
    ownerId: 'u1',
    folderId: 'lm',
    aclSource: 'folder',
    kind,
    title: 'Versión 3 (wip)',
    markdown: body,
    tags: [],
    order: 0,
    version: 1,
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
  }
}

function pane(noteId: string): PaneLeaf {
  return { kind: 'pane', id: 'p1', tabs: [{ id: 't1', noteId }], activeTabId: 't1' }
}

function renderPane(value: Note, creating = false) {
  return mount(
    <NotePane
      pane={pane(value.id)}
      titles={new Map([[value.id, value.title]])}
      note={value}
      noteError={null}
      focused
      uid="u1"
      userName="Yo"
      folders={folders}
      isMobile={false}
      canvasFiles={[]}
      creating={creating}
      onOpenNote={() => {}}
      onFocus={() => {}}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
      onNewNote={() => {}}
      onImport={() => {}}
      emptyWorkspace={false}
      onTagClick={() => {}}
      onRenameTag={() => {}}
      onPresence={() => {}}
      onStatus={() => {}}
    />
  )
}

describe('the note pane header', () => {
  it('puts the folder path above the title, not the old permissions sentence', () => {
    const host = renderPane(note('note', '# Hola'))
    const header = host.querySelector('.doc-header')!
    const crumbs = header.querySelector('.doc-crumbs')!
    expect(Array.from(crumbs.querySelectorAll('.doc-crumb')).map((c) => c.textContent)).toEqual([
      'ObsidianVault',
      'GUIONES',
      'Los Muchachos - Feature Film',
    ])
    // Above the title, not below it.
    expect(crumbs.compareDocumentPosition(header.querySelector('.inline-title')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(host.textContent).not.toContain('permisos heredados')
  })

  it('does the same on a canvas, whose header is the same bar', () => {
    const host = renderPane(note('canvas', '{"nodes":[],"edges":[]}'))
    expect(host.querySelector('[data-testid="canvas-surface"]')).not.toBeNull()
    const header = host.querySelector('.doc-header')!
    const crumbs = header.querySelector('.doc-crumbs')!
    expect(Array.from(crumbs.querySelectorAll('.doc-crumb')).map((c) => c.textContent)).toEqual([
      'ObsidianVault',
      'GUIONES',
      'Los Muchachos - Feature Film',
    ])
    expect(host.textContent).not.toContain('permisos heredados')
  })
})

describe('a note that was just created', () => {
  it('starts with the caret in the title, ready to be named', () => {
    const host = renderPane({ ...note('note', ''), title: '' }, true)
    const title = host.querySelector<HTMLInputElement>('.inline-title')!
    expect(document.activeElement).toBe(title)
  })

  it('leaves the caret alone when an existing note is opened', () => {
    const host = renderPane(note('note', '# Hola'))
    const title = host.querySelector<HTMLInputElement>('.inline-title')!
    expect(document.activeElement).not.toBe(title)
  })
})

describe('the title', () => {
  it('hands the caret to the body on Enter, like Obsidian', () => {
    const host = renderPane(note('note', '# Hola'))
    const title = host.querySelector<HTMLInputElement>('.inline-title')!
    const body = () => host.querySelector('[data-testid="markdown-body"]')!
    expect(body().getAttribute('data-focus')).toBe('0')

    act(() => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(body().getAttribute('data-focus')).toBe('1')
  })

  it('leaves every other key to the title', () => {
    const host = renderPane(note('note', '# Hola'))
    const title = host.querySelector<HTMLInputElement>('.inline-title')!
    act(() => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(host.querySelector('[data-testid="markdown-body"]')!.getAttribute('data-focus')).toBe('0')
  })
})
