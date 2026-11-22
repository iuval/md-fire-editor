// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DocCrumbs } from '../src/components/DocCrumbs'
import type { Folder } from '../src/lib/notes'

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
  folder('v3', 'Versión 3 (wip)', 'lm'),
]

const crumbsOf = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.doc-crumb')).map((crumb) => crumb.textContent)

describe('note breadcrumbs', () => {
  it('shows the folder chain from the root down, the note’s own folder last', () => {
    const host = mount(<DocCrumbs folderId="v3" folders={folders} />)
    expect(crumbsOf(host)).toEqual([
      'ObsidianVault',
      'GUIONES',
      'Los Muchachos - Feature Film',
      'Versión 3 (wip)',
    ])
  })

  it('separates the crumbs and hides the glyph from screen readers', () => {
    const host = mount(<DocCrumbs folderId="v3" folders={folders} />)
    const separators = Array.from(host.querySelectorAll('.doc-crumb-sep'))
    expect(separators).toHaveLength(3)
    expect(separators.map((glyph) => glyph.textContent)).toEqual(['›', '›', '›'])
    expect(separators.every((glyph) => glyph.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('is one labelled landmark, not a pile of loose text', () => {
    const host = mount(<DocCrumbs folderId="lm" folders={folders} />)
    const nav = host.querySelector('nav')
    expect(nav).not.toBeNull()
    expect(nav!.getAttribute('aria-label')).toBe('Note folder')
    expect(crumbsOf(host)).toEqual(['ObsidianVault', 'GUIONES', 'Los Muchachos - Feature Film'])
  })

  it('draws nothing for a note at the root of the workspace', () => {
    const host = mount(<DocCrumbs folderId={null} folders={folders} />)
    expect(host.innerHTML).toBe('')
  })

  it('draws nothing for a folder the list has not loaded yet', () => {
    const host = mount(<DocCrumbs folderId="desconocida" folders={folders} />)
    expect(host.innerHTML).toBe('')
  })

  it('stops on a folder whose parent is missing instead of hanging', () => {
    const host = mount(<DocCrumbs folderId="huérfana" folders={[folder('huérfana', 'Suelta', 'nope')]} />)
    expect(crumbsOf(host)).toEqual(['Suelta'])
  })
})
