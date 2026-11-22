import { describe, expect, it } from 'vitest'
import {
  activeNoteId,
  activeTab,
  closePane,
  closeTab,
  findNote,
  findPane,
  listPanes,
  mergeIntoPane,
  openNoteIds,
  openTab,
  replaceActiveTab,
  sanitizeLayout,
  setActiveTab,
  setRatio,
  singlePane,
  splitPane,
  splitPaneWithActiveTab,
  type PaneLeaf,
} from '../src/lib/panes'

function pane(id: string, noteId: string, tabId = `${id}-tab`): PaneLeaf {
  return { kind: 'pane', id, tabs: [{ id: tabId, noteId }], activeTabId: tabId }
}

describe('panes: tabs', () => {
  it('starts a pane with one active tab', () => {
    const tree = singlePane('p1', 'n1', 't1')
    expect(listPanes(tree)).toHaveLength(1)
    expect(activeTab(tree)).toEqual({ id: 't1', noteId: 'n1' })
    expect(activeNoteId(tree, 'p1')).toBe('n1')
  })

  it('an empty pane opens the current tab in place', () => {
    const tree = replaceActiveTab(singlePane('p1'), 'p1', 'n1', 't1')
    expect(activeTab(tree)).toEqual({ id: 't1', noteId: 'n1' })
  })

  it('opens a note in the current tab, keeping the tab id', () => {
    const tree = replaceActiveTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    expect(listPanes(tree)[0].tabs).toEqual([{ id: 'p1-tab', noteId: 'n2' }])
  })

  it('appends a tab when opening a new note with openTab', () => {
    const tree = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    const first = listPanes(tree)[0]
    expect(first.tabs).toEqual([
      { id: 'p1-tab', noteId: 'n1' },
      { id: 't2', noteId: 'n2' },
    ])
    expect(first.activeTabId).toBe('t2')
  })

  it('activates the existing tab instead of duplicating a note', () => {
    const base = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    const back = openTab(base, 'p1', 'n1', 't3')
    const first = listPanes(back)[0]
    expect(first.tabs).toHaveLength(2)
    expect(first.activeTabId).toBe('p1-tab')
  })

  it('sets the active tab only inside the target pane', () => {
    const base = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    const tree = setActiveTab(base, 'p1', 'p1-tab')
    expect(listPanes(tree)[0].activeTabId).toBe('p1-tab')
    expect(setActiveTab(base, 'nope', 't2')).toBe(base)
  })

  it('closing the active tab activates the next one, then the previous', () => {
    let tree = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    tree = openTab(tree, 'p1', 'n3', 't3')
    tree = closeTab(tree, 'p1', 't2')
    expect(listPanes(tree)[0].activeTabId).toBe('t3')
    tree = closeTab(tree, 'p1', 't3')
    expect(listPanes(tree)[0].activeTabId).toBe('p1-tab')
    expect(listPanes(tree)[0].tabs).toHaveLength(1)
  })

  it('closing the last tab of the only pane leaves it empty', () => {
    const tree = closeTab(singlePane('p1', 'n1'), 'p1', 'p1-tab')
    const panes = listPanes(tree)
    expect(panes).toHaveLength(1)
    expect(panes[0].tabs).toHaveLength(0)
    expect(panes[0].activeTabId).toBeNull()
  })

  it('closing the last tab collapses the pane into its sibling', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    const collapsed = closeTab(tree, 'p2', 'p2-tab')
    expect(listPanes(collapsed)).toHaveLength(1)
    expect(findPane(collapsed, 'p1')).not.toBeNull()
    expect(findPane(collapsed, 'p2')).toBeNull()
  })

  it('lists open notes once, in pane order', () => {
    let tree = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    tree = splitPane(tree, 'p1', 'row', pane('p2', 'n3'), 's1')
    expect(openNoteIds(tree)).toEqual(['n1', 'n2', 'n3'])
    expect(findNote(tree, 'n2')).toEqual({ paneId: 'p1', tabId: 't2' })
    expect(findNote(tree, 'n3')).toEqual({ paneId: 'p2', tabId: 'p2-tab' })
    expect(findNote(tree, 'zzz')).toBeNull()
  })
})

describe('panes: splitting', () => {
  it('puts the new pane to the right and keeps the old one first', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    expect(tree.kind).toBe('split')
    if (tree.kind !== 'split') return
    expect(tree.direction).toBe('row')
    expect(tree.ratio).toBe(0.5)
    expect(listPanes(tree).map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('splits below with a column direction', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'column', pane('p2', 'n2'), 's1')
    expect(tree.kind === 'split' && tree.direction).toBe('column')
  })

  it('can split a nested pane without limit', () => {
    let tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    tree = splitPane(tree, 'p2', 'column', pane('p3', 'n3'), 's2')
    tree = splitPane(tree, 'p3', 'row', pane('p4', 'n4'), 's3')
    expect(listPanes(tree).map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(findPane(tree, 'p1')).not.toBeNull()
  })

  it('closes a pane and lets its sibling take the space', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    const closed = closePane(tree, 'p2')
    expect(listPanes(closed).map((p) => p.id)).toEqual(['p1'])
    expect(closed.kind).toBe('pane')
  })

  it('empties the last pane instead of removing the workspace', () => {
    const closed = closePane(singlePane('p1', 'n1'), 'p1')
    const panes = listPanes(closed)
    expect(panes).toHaveLength(1)
    expect(panes[0].tabs).toEqual([])
    expect(panes[0].activeTabId).toBeNull()
  })

  it('ignores an unknown pane when closing', () => {
    const base = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    expect(closePane(base, 'nope')).toBe(base)
  })

  it('merges every pane into one tab set for a phone', () => {
    let tree = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    tree = splitPane(tree, 'p1', 'row', pane('p2', 'n3'), 's1')
    const merged = mergeIntoPane(tree, 'p2')
    expect(merged.id).toBe('p2')
    expect(merged.tabs.map((tab) => tab.noteId)).toEqual(['n3', 'n1', 'n2'])
    expect(merged.activeTabId).toBe('p2-tab')
  })

  it('keeps a single pane untouched when merging the focused one', () => {
    const base = openTab(singlePane('p1', 'n1'), 'p1', 'n2', 't2')
    const merged = mergeIntoPane(base, 'p1')
    expect(merged.tabs).toEqual(listPanes(base)[0].tabs)
    expect(merged.activeTabId).toBe('t2')
  })

  it('opens a copy of the active page in the new pane', () => {
    const tree = splitPaneWithActiveTab(singlePane('p1', 'n1'), 'p1', 'row', {
      paneId: 'p2',
      tabId: 't2',
      splitId: 's1',
    })
    const panes = listPanes(tree)
    expect(panes.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(panes.map((p) => activeTab(p)?.noteId)).toEqual(['n1', 'n1'])
    // Distinct tabs: the same note in two panes, not the same tab twice.
    expect(activeTab(panes[0])?.id).not.toBe(activeTab(panes[1])?.id)
  })

  it('splits an empty pane into another empty pane', () => {
    const tree = splitPaneWithActiveTab(singlePane('p1'), 'p1', 'column', {
      paneId: 'p2',
      tabId: 't2',
      splitId: 's1',
    })
    const panes = listPanes(tree)
    expect(panes[1].tabs).toEqual([])
    expect(panes[1].activeTabId).toBeNull()
  })

  it('ignores an unknown pane id when splitting', () => {
    const base = singlePane('p1', 'n1')
    expect(
      splitPaneWithActiveTab(base, 'nope', 'row', { paneId: 'p2', tabId: 't2', splitId: 's1' })
    ).toBe(base)
  })

  it('ignores an unknown pane id', () => {
    const base = singlePane('p1', 'n1')
    expect(splitPane(base, 'nope', 'row', pane('p2', 'n2'), 's1')).toBe(base)
  })

  it('clamps the split ratio', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    const tight = setRatio(tree, 's1', 0.99)
    expect(tight.kind === 'split' && tight.ratio).toBe(0.85)
    const wide = setRatio(tree, 's1', 0)
    expect(wide.kind === 'split' && wide.ratio).toBe(0.15)
  })
})

describe('panes: persisted layout', () => {
  it('round-trips a valid layout', () => {
    const tree = splitPane(singlePane('p1', 'n1'), 'p1', 'row', pane('p2', 'n2'), 's1')
    expect(sanitizeLayout(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
  })

  it('rejects garbage', () => {
    expect(sanitizeLayout(null)).toBeNull()
    expect(sanitizeLayout('nope')).toBeNull()
    expect(sanitizeLayout({ kind: 'weird' })).toBeNull()
    expect(sanitizeLayout({ kind: 'pane', id: '', tabs: [], activeTabId: null })).toBeNull()
  })

  it('repairs a dangling active tab and duplicate pane ids', () => {
    const repaired = sanitizeLayout({
      kind: 'pane',
      id: 'p1',
      tabs: [
        { id: 't1', noteId: 'n1' },
        { id: 't1', noteId: 'n2' },
      ],
      activeTabId: 'gone',
    })
    expect(repaired).not.toBeNull()
    if (!repaired || repaired.kind !== 'pane') return
    expect(repaired.activeTabId).toBe('t1')
    expect(repaired.tabs).toHaveLength(1)

    const rejected = sanitizeLayout({
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'pane', id: 'p1', tabs: [], activeTabId: null },
      second: { kind: 'pane', id: 'p1', tabs: [], activeTabId: null },
    })
    expect(rejected).toBeNull()
  })

  it('keeps the same note in two panes but never twice in one', () => {
    const layout = sanitizeLayout({
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'pane', id: 'p1', tabs: [{ id: 't1', noteId: 'n1' }], activeTabId: 't1' },
      second: {
        kind: 'pane',
        id: 'p2',
        tabs: [
          { id: 't2', noteId: 'n1' },
          { id: 't3', noteId: 'n1' },
          { id: 't4', noteId: 'n2' },
        ],
        activeTabId: 't2',
      },
    })
    expect(layout).not.toBeNull()
    if (!layout || layout.kind !== 'split') return
    expect(listPanes(layout)[0].tabs.map((tab) => tab.noteId)).toEqual(['n1'])
    expect(listPanes(layout)[1].tabs.map((tab) => tab.noteId)).toEqual(['n1', 'n2'])
  })

  it('clamps a persisted ratio', () => {
    const layout = sanitizeLayout({
      kind: 'split',
      id: 's1',
      direction: 'column',
      ratio: 4,
      first: { kind: 'pane', id: 'p1', tabs: [], activeTabId: null },
      second: { kind: 'pane', id: 'p2', tabs: [], activeTabId: null },
    })
    expect(layout?.kind === 'split' && layout.ratio).toBe(0.85)
  })
})
