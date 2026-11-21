// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CollaborativeEditor } from '../src/components/CollaborativeEditor'
import type { Note } from '../src/lib/notes'

let roots: Root[] = []

afterEach(() => {
  roots.forEach((root) => root.unmount())
  roots = []
  document.body.innerHTML = ''
})

function note(id: string): Note {
  return {
    id,
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own',
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    title: 'Nota',
    markdown: '',
    tags: [],
    version: 1,
  }
}

function mount(id: string, body: string, calls: string[]): Root {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <CollaborativeEditor
        note={{ ...note(id), markdown: body }}
        body={body}
        uid="u1"
        userName="Ana"
        editable
        onMarkdownChange={(md) => calls.push(md)}
        onPresence={() => undefined}
        onStatus={() => undefined}
      />
    )
  })
  return root
}

describe('opening a note must not write', () => {
  it('does not emit markdown when the body is only seeded', () => {
    const calls: string[] = []
    mount('echo-1', '# Nota\n\ncuerpo\n', calls)
    expect(calls).toEqual([])
  })

  it('does not emit when the stored body differs only by trailing whitespace', () => {
    const calls: string[] = []
    mount('echo-2', '# Nota\n\ncuerpo', calls)
    expect(calls).toEqual([])
  })
})
