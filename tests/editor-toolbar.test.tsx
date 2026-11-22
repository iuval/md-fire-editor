// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CollaborativeEditor } from '../src/components/CollaborativeEditor'
import type { Note } from '../src/lib/notes'

const note: Note = {
  id: 'n-toolbar',
  ownerId: 'u1',
  memberIds: ['u1'],
  roles: { u1: 'owner' },
  access: 'restricted',
  folderId: null,
  aclSource: 'own',
  title: 'Demo',
  markdown: 'Texto',
  tags: [],
  order: 0,
  version: 1,
}

let roots: Root[] = []

function mount(isMobile: boolean) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() =>
    root.render(
      <CollaborativeEditor
        note={note}
        body="Texto"
        uid="u1"
        userName="Ana"
        editable
        isMobile={isMobile}
        onMarkdownChange={() => {}}
        onPresence={() => {}}
        onStatus={() => {}}
      />
    )
  )
  return host
}

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()))
  roots = []
  document.body.innerHTML = ''
})

describe('mobile formatting toolbar', () => {
  it('only exists on phones', () => {
    const desktop = mount(false)
    expect(desktop.querySelector('.editor-toolbar')).toBeNull()
  })

  it('stays hidden until the editor has focus, then shows the actions', () => {
    const host = mount(true)
    const bar = host.querySelector('.editor-toolbar')
    expect(bar).not.toBeNull()
    expect(bar!.classList.contains('is-visible')).toBe(false)

    const editable = host.querySelector('.md-editor-content') as HTMLElement
    act(() => editable.focus())
    expect(host.querySelector('.editor-toolbar')!.classList.contains('is-visible')).toBe(true)

    const labels = [...host.querySelectorAll('.editor-toolbar-btn')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Heading 1', 'Heading 2', 'Bold', 'Italic', 'List', 'Quote'])
  })
})
