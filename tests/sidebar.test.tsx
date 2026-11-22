// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sidebar, type SidebarProps } from '../src/components/Sidebar'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  TREE_INDENT,
  TREE_ROW_STEP,
  clampSidebarWidth,
  guideIndent,
} from '../src/lib/sidebarLayout'
import type { ProviderStatus } from '../src/lib/collab/provider'
import type { Folder, Note } from '../src/lib/notes'
import { buildTagTree } from '../src/lib/tags'

let roots: Root[] = []
let host: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(ui))
  return host
}

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()))
  roots = []
  document.body.innerHTML = ''
  host = null
})

beforeEach(() => {
  localStorage.clear()
})

function folder(id: string, name: string, parentId: string | null = null): Folder {
  return {
    id,
    ownerId: 'u1',
    name,
    parentId,
    tags: [],
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    order: 0,
  }
}

function note(id: string, title: string, folderId: string | null, tags: string[] = []): Note {
  return {
    id,
    ownerId: 'u1',
    folderId,
    aclSource: 'own',
    title,
    markdown: '',
    tags,
    order: 0,
    version: 1,
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
  }
}

const nested = [folder('g', 'GUIONES'), folder('lm', 'Los Muchachos', 'g'), folder('v3', 'V3', 'lm')]
const withNotes = [
  note('n1', 'Nota raíz', null, ['trabajo']),
  note('n2', 'Diseño de sincronización', 'v3', ['trabajo/acme']),
]

function render(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    notes: withNotes,
    folders: nested,
    activeId: null,
    onSelect: () => {},
    onNewNote: () => {},
    onNewFolder: () => {},
    onNewCanvas: () => {},
    rootSort: 'updated',
    onFolderMenu: () => {},
    expanded: new Set(['g', 'lm', 'v3']),
    onToggleFolder: () => {},
    onClose: () => {},
    onCollapse: () => {},
    isMobile: false,
    isOpen: true,
    status: { connected: true, pendingWrites: 0, updateCount: 0, error: null },
    loading: false,
    tagTree: buildTagTree(withNotes),
    selectedTags: [],
    onToggleTag: () => {},
    uid: 'u1',
    userName: 'Iuval',
    photoURL: null,
    onAccountClick: () => {},
    ...overrides,
  }
  return mount(<Sidebar {...props} />)
}

/** Sum of the inline indent contributions from a row up to the tree root. */
function totalIndent(row: HTMLElement): number {
  let total = 0
  let node: HTMLElement | null = row
  while (node && !node.classList.contains('file-list')) {
    const pad = parseFloat(node.style.paddingLeft || '0')
    if (Number.isFinite(pad)) total += pad
    node = node.parentElement
  }
  return total
}

describe('sidebar head', () => {
  it('carries the app name and the three create actions plus collapse', () => {
    const el = render()
    const head = el.querySelector('.sidebar-head')!

    expect(head.querySelector('.sidebar-title')!.textContent).toBe('FireMD')
    expect([...head.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Nueva nota',
      'Nueva carpeta',
      'Nuevo canvas',
      'Ocultar panel',
    ])
    // Nothing else lives up there: no overflow menu, no section label.
    expect(head.querySelector('[aria-label="Más acciones"]')).toBeNull()
  })

  it('fires each create action from its own button', () => {
    const calls: string[] = []
    const el = render({
      onNewNote: () => calls.push('note'),
      onNewFolder: () => calls.push('folder'),
      onNewCanvas: () => calls.push('canvas'),
    })
    const head = el.querySelector('.sidebar-head')!
    for (const label of ['Nueva nota', 'Nueva carpeta', 'Nuevo canvas']) {
      act(() => head.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
    }
    expect(calls).toEqual(['note', 'folder', 'canvas'])
  })

  it('closes the drawer on a phone instead of collapsing it', () => {
    const calls: string[] = []
    const el = render({
      isMobile: true,
      onClose: () => calls.push('close'),
      onCollapse: () => calls.push('collapse'),
    })
    const button = el.querySelector<HTMLButtonElement>('.sidebar-head [aria-label="Cerrar panel"]')!
    act(() => button.click())
    expect(calls).toEqual(['close'])
  })
})

describe('sidebar collapse', () => {
  it('actually collapses the desktop panel, not just the button state', () => {
    const open = render({ isOpen: true })
    const aside = open.querySelector('aside')!
    expect(aside.classList.contains('collapsed')).toBe(false)
    expect(aside.getAttribute('aria-hidden')).toBeNull()

    act(() => roots[0].unmount())
    roots = []
    document.body.innerHTML = ''

    const closed = render({ isOpen: false })
    const hidden = closed.querySelector('aside')!
    expect(hidden.classList.contains('collapsed')).toBe(true)
    expect(hidden.getAttribute('aria-hidden')).toBe('true')
  })

  it('never marks the phone drawer as collapsed', () => {
    const el = render({ isMobile: true, isOpen: false })
    const aside = el.querySelector('aside')!
    expect(aside.classList.contains('collapsed')).toBe(false)
    expect(aside.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Etiquetas panel', () => {
  it('starts collapsed so the file tree gets the space', () => {
    const el = render()
    const toggle = el.querySelector('.tag-panel-toggle') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelectorAll('.tag-tree-row')).toHaveLength(0)
  })

  it('expands on demand and remembers the choice', () => {
    const el = render()
    const toggle = el.querySelector('.tag-panel-toggle') as HTMLButtonElement
    act(() => toggle.click())

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(el.querySelectorAll('.tag-tree-row').length).toBeGreaterThan(0)
    expect(localStorage.getItem('firemd-tags-open')).toBe('1')

    act(() => roots[0].unmount())
    roots = []
    document.body.innerHTML = ''

    const reopened = render()
    expect(reopened.querySelectorAll('.tag-tree-row').length).toBeGreaterThan(0)
  })

  it('honours a stored "closed" preference', () => {
    localStorage.setItem('firemd-tags-open', '0')
    const el = render()
    expect(el.querySelectorAll('.tag-tree-row')).toHaveLength(0)
  })
})

describe('tree indentation', () => {
  it('spends 12px per nesting level instead of 24px', () => {
    expect(TREE_INDENT).toBe(12)
  })

  it('walks nested rows at a constant 12px step', () => {
    const el = render()
    const rows = [...el.querySelectorAll<HTMLElement>('.folder-toggle')]
    const totals = rows.map(totalIndent)

    expect(rows.map((r) => r.textContent?.trim().slice(0, 8))).toEqual([
      'GUIONES',
      'Los Much',
      'V3',
    ])
    expect(totals[0]).toBe(6)
    expect(totals[1] - totals[0]).toBe(12)
    expect(totals[2] - totals[1]).toBe(12)
  })

  it('keeps notes aligned with the sibling folder rows', () => {
    const el = render()
    const items = [...el.querySelectorAll<HTMLElement>('.file-item')]
    const design = items.find((i) => i.textContent?.includes('Diseño'))!
    const rootNote = items.find((i) => i.textContent?.includes('Nota raíz'))!
    const v3 = [...el.querySelectorAll<HTMLElement>('.folder-toggle')].find((r) =>
      r.textContent?.includes('V3')
    )!

    // A note inside `v3` sits at the same offset as a folder child of `v3`.
    expect(totalIndent(design)).toBe(totalIndent(v3) + TREE_INDENT)
    expect(totalIndent(rootNote)).toBe(totalIndent([...el.querySelectorAll<HTMLElement>('.folder-toggle')][0]))
  })
})

describe('footer', () => {
  it('keeps the avatar and one menu button, and drops the name', () => {
    const el = render({ userName: 'Iuval' })
    const foot = el.querySelector('.sidebar-foot')!

    expect(foot.querySelector('.avatar')).not.toBeNull()
    expect(foot.querySelector('.account-name')).toBeNull()
    expect(foot.textContent?.trim()).toBe('')

    // Two controls: the sync dot and the account menu. Only the menu carries
    // the name, since the label no longer sits in the strip.
    const buttons = [...foot.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    const menu = buttons.find((b) => b.className.includes('icon-btn'))!
    expect(menu.getAttribute('aria-label')).toBe('Cuenta y ajustes de Iuval')
    expect(menu.getAttribute('title')).toContain('Iuval')
  })

  it('marks that button with the gear, the same as the collapsed rail', () => {
    const el = render({ userName: 'Iuval' })
    const menu = el.querySelector('.sidebar-foot .icon-btn')!
    // The preferences entry, not a row's "more" menu: the rail shows this gear
    // too, so the control reads the same in both states.
    expect(menu.querySelector('svg')?.getAttribute('class')).toContain('settings')
  })

  it('opens the account menu from that button', () => {
    let opened = 0
    const el = render({ onAccountClick: () => (opened += 1) })
    const button = el.querySelector('.sidebar-foot .icon-btn') as HTMLButtonElement
    act(() => button.click())
    expect(opened).toBe(1)
  })
})

describe('sync dot in the footer', () => {
  const statusWith = (patch: Partial<ProviderStatus>): ProviderStatus => ({
    connected: true,
    pendingWrites: 0,
    updateCount: 0,
    error: null,
    ...patch,
  })

  it('shows a bare coloured dot next to the avatar, with no words', () => {
    const el = render()
    const foot = el.querySelector('.sidebar-foot')!
    const dot = foot.querySelector('.sync-dot')!
    expect(dot).not.toBeNull()
    expect(foot.textContent?.trim()).toBe('')
    expect(foot.querySelector('.sync-dot-btn')!.className).toContain('sync--ok')
  })

  it('paints the tone of the current state', () => {
    const saving = render({ status: statusWith({ pendingWrites: 3 }) })
    expect(saving.querySelector('.sync-dot-btn')!.className).toContain('sync--pending')

    act(() => roots[0].unmount())
    roots = []
    document.body.innerHTML = ''

    const offline = render({ status: statusWith({ error: 'Sin permisos' }) })
    expect(offline.querySelector('.sync-dot-btn')!.className).toContain('sync--error')
  })

  it('reveals the status when tapped, and hides it again', () => {
    const el = render({ status: statusWith({ pendingWrites: 1 }) })
    const button = el.querySelector('.sync-dot-btn') as HTMLButtonElement

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('.sync-bubble')).toBeNull()
    expect(button.getAttribute('aria-label')).toContain('Guardando')

    act(() => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const bubble = el.querySelector('.sync-bubble')!
    expect(bubble.textContent).toContain('Guardando')
    // The word alone cannot say why the dot is not green.
    expect(bubble.querySelector('.sync-detail')!.textContent).toBe('1 cambio sin enviar')

    act(() => button.click())
    expect(el.querySelector('.sync-bubble')).toBeNull()
  })

  it('closes the revealed status on Escape', () => {
    const el = render({ status: statusWith({ connected: false }) })
    const button = el.querySelector('.sync-dot-btn') as HTMLButtonElement
    act(() => button.click())
    expect(el.querySelector('.sync-bubble')!.textContent).toContain('Conectando')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(el.querySelector('.sync-bubble')).toBeNull()
  })
})

describe('notice in the footer', () => {
  it('leaves the footer bare when there is nothing to report', () => {
    const el = render()
    expect(el.querySelector('.notice-btn')).toBeNull()
    expect(el.querySelector('.sidebar-foot')!.textContent?.trim()).toBe('')
  })

  it('holds the message in the icon tooltip instead of printing it', () => {
    const message = 'No se pudo crear la nota. Revisá la conexión.'
    const el = render({ notice: message })
    const button = el.querySelector('.notice-btn') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.getAttribute('title')).toBe(message)
    expect(button.getAttribute('aria-label')).toContain(message)
    expect(el.querySelector('.sidebar-foot')!.textContent?.trim()).toBe('')
  })

  it('reveals the message on tap and hands the dismissal up', () => {
    let dismissed = 0
    const el = render({
      notice: 'Exportadas 3 notas en notas.zip.',
      onDismissNotice: () => {
        dismissed += 1
      },
    })
    const button = el.querySelector('.notice-btn') as HTMLButtonElement

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('.notice-bubble')).toBeNull()

    act(() => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(el.querySelector('.notice-bubble')!.textContent).toContain('Exportadas 3 notas')

    const close = el.querySelector('.notice-bubble button') as HTMLButtonElement
    act(() => close.click())
    expect(dismissed).toBe(1)
    expect(el.querySelector('.notice-bubble')).toBeNull()
  })

  it('closes the revealed notice on Escape', () => {
    const el = render({ notice: 'No se pudo guardar el orden. Revisá la conexión.' })
    const button = el.querySelector('.notice-btn') as HTMLButtonElement
    act(() => button.click())
    expect(el.querySelector('.notice-bubble')).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(el.querySelector('.notice-bubble')).toBeNull()
  })
})

describe('tree rows', () => {
  it('shows only the title, no date/preview subtitle', () => {
    const el = render()
    const items = [...el.querySelectorAll<HTMLElement>('.file-item')]
    expect(items.length).toBeGreaterThan(0)
    items.forEach((item) => expect(item.querySelector('.file-meta')).toBeNull())

    const design = items.find((i) => i.textContent?.includes('Diseño'))!
    expect(design.textContent?.trim()).toBe('Diseño de sincronización')
  })
})

describe('parent guides', () => {
  it('lands the rail under the parent chevron at every depth', () => {
    // The rail sits on the parent chevron centre: 12px in at depth 0, then the
    // row step per level.
    expect(guideIndent(0)).toBe(12)
    expect(guideIndent(1) - guideIndent(0)).toBe(TREE_ROW_STEP)
    expect(guideIndent(3) - guideIndent(2)).toBe(TREE_ROW_STEP)
  })

  it('marks each expanded children container with its rail offset', () => {
    const el = render()
    const containers = [...el.querySelectorAll<HTMLElement>('.tree-notes')]
    expect(containers.length).toBeGreaterThan(1)
    expect(containers[0].style.getPropertyValue('--guide-x')).toBe(`${guideIndent(0)}px`)
    expect(containers[1].style.getPropertyValue('--guide-x')).toBe(`${guideIndent(1)}px`)
  })

  it('draws no rail for a collapsed folder', () => {
    const el = render({ expanded: new Set() })
    expect(el.querySelectorAll('.tree-notes')).toHaveLength(0)
  })
})

describe('panel width', () => {
  it('clamps out-of-range and non-numeric widths', () => {
    expect(clampSidebarWidth(120)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(9000)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(312.6)).toBe(313)
  })

  it('starts at the default width and stores it as a CSS variable', () => {
    const el = render()
    const aside = el.querySelector('aside') as HTMLElement
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe(`${DEFAULT_SIDEBAR_WIDTH}px`)
  })

  it('resizes by dragging the edge and persists the width', () => {
    const el = render()
    const aside = el.querySelector('aside') as HTMLElement
    const handle = el.querySelector('.sidebar-resizer') as HTMLElement

    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 240 }))
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 320 }))
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })

    expect(aside.style.getPropertyValue('--sidebar-w')).toBe('320px')
    expect(localStorage.getItem('firemd-sidebar-width')).toBe('320')

    // A drag past either bound stops at it.
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 320 }))
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 9000 }))
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe(`${MAX_SIDEBAR_WIDTH}px`)
  })

  it('restores a stored width on the next visit', () => {
    localStorage.setItem('firemd-sidebar-width', '360')
    const el = render()
    const aside = el.querySelector('aside') as HTMLElement
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe('360px')
    expect((el.querySelector('.sidebar-resizer') as HTMLElement).getAttribute('aria-valuenow')).toBe('360')
  })

  it('resizes from the keyboard', () => {
    const el = render()
    const aside = el.querySelector('aside') as HTMLElement
    const handle = el.querySelector('.sidebar-resizer') as HTMLElement

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe(`${DEFAULT_SIDEBAR_WIDTH + 16}px`)

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe(`${MIN_SIDEBAR_WIDTH}px`)

    act(() => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(aside.style.getPropertyValue('--sidebar-w')).toBe(`${MAX_SIDEBAR_WIDTH}px`)
  })

  it('offers no resize handle on the phone drawer', () => {
    const el = render({ isMobile: true })
    expect(el.querySelector('.sidebar-resizer')).toBeNull()
  })
})

describe('horizontal scrolling for long trees', () => {
  it('wraps the tree so rows can grow past the panel width', () => {
    const el = render()
    const tree = el.querySelector('.file-list > .file-tree')
    expect(tree).not.toBeNull()
    expect(tree!.querySelectorAll('.folder-toggle').length).toBeGreaterThan(0)
  })

  it('wraps the tag rows the same way', () => {
    localStorage.setItem('firemd-tags-open', '1')
    const el = render()
    expect(el.querySelector('.tag-tree > .tag-tree-rows')).not.toBeNull()
  })
})

describe('row actions', () => {
  it('gives every note the same ⋯ the folders already have', () => {
    const el = render()
    const labels = [...el.querySelectorAll<HTMLElement>('.file-row [aria-label^="Acciones de "]')].map(
      (b) => b.getAttribute('aria-label')
    )
    // One per note, whichever branch of the tree it hangs from.
    expect([...labels].sort()).toEqual([
      'Acciones de Diseño de sincronización',
      'Acciones de Nota raíz',
    ])
  })

  it('opens the note menu with the note that owns the row', () => {
    const opened: { id: string; x: number; y: number }[] = []
    const el = render({
      onNoteMenu: (note, pos) => opened.push({ id: note.id, ...pos }),
    })
    const button = el.querySelector<HTMLElement>('[aria-label="Acciones de Diseño de sincronización"]')!
    act(() => button.click())
    expect(opened).toHaveLength(1)
    expect(opened[0].id).toBe('n2')
    expect(Number.isFinite(opened[0].x)).toBe(true)
  })

  it('opens the note menu from a right click on the row too', () => {
    const opened: string[] = []
    const el = render({ onNoteMenu: (note) => opened.push(note.id) })
    const row = el.querySelector<HTMLElement>('[aria-label="Acciones de Nota raíz"]')!.parentElement!
    act(() =>
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }))
    )
    expect(opened).toEqual(['n1'])
  })

  it('opens the folder menu from a right click on the folder row', () => {
    const opened: string[] = []
    const el = render({ onFolderMenu: (folder) => opened.push(folder.id) })
    const row = el.querySelector<HTMLElement>('[aria-label="Acciones de V3"]')!.parentElement!
    act(() =>
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 20 }))
    )
    expect(opened).toEqual(['v3'])
  })
})
