/**
 * Tabs and split panes, as one immutable tree.
 *
 * A pane holds tabs; splitting replaces a pane with a `split` node whose first
 * child is the pane that was there and whose second child is the pane that was
 * asked for. Because every node can be split again, panes nest without limit.
 * Every operation returns the same tree when nothing changes, so React can skip
 * the re-render.
 */

export type SplitDirection = 'row' | 'column'

export interface PaneTab {
  id: string
  noteId: string
}

export interface PaneLeaf {
  kind: 'pane'
  id: string
  tabs: PaneTab[]
  activeTabId: string | null
}

export interface PaneSplit {
  kind: 'split'
  id: string
  /** `row`: side by side. `column`: stacked. */
  direction: SplitDirection
  /** Share of the space taken by the first child, 0..1. */
  ratio: number
  first: PaneTree
  second: PaneTree
}

export type PaneTree = PaneLeaf | PaneSplit

export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
export const DEFAULT_RATIO = 0.5
/** Guards against a corrupt or hostile layout in localStorage. */
export const MAX_DEPTH = 24

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
}

export function singlePane(paneId: string, noteId?: string | null, tabId?: string): PaneLeaf {
  const tabs: PaneTab[] = noteId ? [{ id: tabId ?? `${paneId}-tab`, noteId }] : []
  return { kind: 'pane', id: paneId, tabs, activeTabId: tabs[0]?.id ?? null }
}

export function listPanes(tree: PaneTree): PaneLeaf[] {
  if (tree.kind === 'pane') return [tree]
  return [...listPanes(tree.first), ...listPanes(tree.second)]
}

/**
 * How many panes the layout may hold.
 *
 * Splitting is cheap to draw and expensive to hold: every pane mounts its own
 * ProseMirror editor for its active tab, and one editor costs ~2,5 MB plus ~50×
 * the note's markdown (measured: 7,35 MB for a 100 KB note, 16,9 MB for 250 KB).
 * The number is a budget, not a target: ten panes of small notes are ~30 MB, but
 * ten panes holding the 250 KB maximum would be ~170 MB, and past six or seven
 * they are only useful on a wide screen.
 */
export const MAX_PANES = 10

/** True while another pane still fits in the budget. */
export function canSplit(tree: PaneTree): boolean {
  return listPanes(tree).length < MAX_PANES
}

export function findPane(tree: PaneTree, paneId: string): PaneLeaf | null {
  if (tree.kind === 'pane') return tree.id === paneId ? tree : null
  return findPane(tree.first, paneId) ?? findPane(tree.second, paneId)
}

export function activeTab(pane: PaneLeaf): PaneTab | null {
  return pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null
}

/** Note shown in a pane, `null` for an empty pane. */
export function activeNoteId(tree: PaneTree, paneId: string): string | null {
  const pane = findPane(tree, paneId)
  return pane ? (activeTab(pane)?.noteId ?? null) : null
}

/** One note per pane, the only notes that need an open document. */
export function activeNoteIds(tree: PaneTree): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const pane of listPanes(tree)) {
    const noteId = activeTab(pane)?.noteId
    if (noteId && !seen.has(noteId)) {
      seen.add(noteId)
      ids.push(noteId)
    }
  }
  return ids
}

/** Every note that has a tab anywhere, in pane order, without duplicates. */
export function openNoteIds(tree: PaneTree): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const pane of listPanes(tree)) {
    for (const tab of pane.tabs) {
      if (!seen.has(tab.noteId)) {
        seen.add(tab.noteId)
        ids.push(tab.noteId)
      }
    }
  }
  return ids
}

export function findNote(tree: PaneTree, noteId: string): { paneId: string; tabId: string } | null {
  for (const pane of listPanes(tree)) {
    const tab = pane.tabs.find((candidate) => candidate.noteId === noteId)
    if (tab) return { paneId: pane.id, tabId: tab.id }
  }
  return null
}

/**
 * Every open file as tabs of one pane. A phone shows a single pane, so tabs that
 * lived in other panes must not disappear; the split layout is desktop-only.
 */
export function mergeIntoPane(tree: PaneTree, paneId: string): PaneLeaf {
  const panes = listPanes(tree)
  const focused = panes.find((pane) => pane.id === paneId) ?? panes[0]
  const tabs: PaneTab[] = []
  const seen = new Set<string>()
  const order = [focused, ...panes.filter((pane) => pane.id !== focused.id)]
  for (const pane of order) {
    for (const tab of pane.tabs) {
      if (seen.has(tab.noteId)) continue
      seen.add(tab.noteId)
      tabs.push(tab)
    }
  }
  const active = activeTab(focused)
  const activeTabId = active && tabs.some((tab) => tab.id === active.id) ? active.id : (tabs[0]?.id ?? null)
  return { kind: 'pane', id: focused.id, tabs, activeTabId }
}

function mapPane(
  tree: PaneTree,
  paneId: string,
  fn: (pane: PaneLeaf) => PaneTree
): PaneTree {
  if (tree.kind === 'pane') return tree.id === paneId ? fn(tree) : tree
  const first = mapPane(tree.first, paneId, fn)
  const second = mapPane(tree.second, paneId, fn)
  if (first === tree.first && second === tree.second) return tree
  return { ...tree, first, second }
}

function mapSplit(tree: PaneTree, splitId: string, fn: (split: PaneSplit) => PaneTree): PaneTree {
  if (tree.kind === 'pane') return tree
  if (tree.id === splitId) return fn(tree)
  const first = mapSplit(tree.first, splitId, fn)
  const second = mapSplit(tree.second, splitId, fn)
  if (first === tree.first && second === tree.second) return tree
  return { ...tree, first, second }
}

export function setActiveTab(tree: PaneTree, paneId: string, tabId: string): PaneTree {
  return mapPane(tree, paneId, (pane) =>
    pane.tabs.some((tab) => tab.id === tabId) && pane.activeTabId !== tabId
      ? { ...pane, activeTabId: tabId }
      : pane
  )
}

/** Opens a note in the pane's current tab — the sidebar's click behaviour. */
export function replaceActiveTab(
  tree: PaneTree,
  paneId: string,
  noteId: string,
  tabId: string
): PaneTree {
  return mapPane(tree, paneId, (pane) => {
    const existing = pane.tabs.find((tab) => tab.noteId === noteId)
    if (existing) return pane.activeTabId === existing.id ? pane : { ...pane, activeTabId: existing.id }
    const active = activeTab(pane)
    if (!active) {
      const tab = { id: tabId, noteId }
      return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }
    }
    return {
      ...pane,
      tabs: pane.tabs.map((tab) => (tab.id === active.id ? { ...tab, noteId } : tab)),
    }
  })
}

/** Adds a tab and activates it, or activates the tab that already has the note. */
export function openTab(tree: PaneTree, paneId: string, noteId: string, tabId: string): PaneTree {
  return mapPane(tree, paneId, (pane) => {
    const existing = pane.tabs.find((tab) => tab.noteId === noteId)
    if (existing) return pane.activeTabId === existing.id ? pane : { ...pane, activeTabId: existing.id }
    const tab = { id: tabId, noteId }
    return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }
  })
}

function removePane(tree: PaneTree, paneId: string): PaneTree | null {
  if (tree.kind === 'pane') return tree.id === paneId ? null : tree
  const first = removePane(tree.first, paneId)
  const second = removePane(tree.second, paneId)
  if (first && second) {
    if (first === tree.first && second === tree.second) return tree
    return { ...tree, first, second }
  }
  return first ?? second
}

export function closeTab(tree: PaneTree, paneId: string, tabId: string): PaneTree {
  const pane = findPane(tree, paneId)
  if (!pane) return tree
  const index = pane.tabs.findIndex((tab) => tab.id === tabId)
  if (index < 0) return tree

  const tabs = pane.tabs.filter((tab) => tab.id !== tabId)
  const nextActive =
    pane.activeTabId === tabId
      ? (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null
      : pane.activeTabId
  const next: PaneLeaf = { ...pane, tabs, activeTabId: nextActive }

  if (tabs.length > 0) return mapPane(tree, paneId, () => next)
  // The last tab is gone: the pane goes with it, its sibling takes the space.
  const pruned = mapPane(tree, paneId, () => next)
  return removePane(pruned, paneId) ?? pruned
}

/**
 * Closes a whole pane, tabs and all: the split collapses and its sibling takes
 * the space. The last pane is emptied instead of removed, because the workspace
 * always needs somewhere to open a file.
 */
export function closePane(tree: PaneTree, paneId: string): PaneTree {
  if (tree.kind === 'pane') {
    return tree.id === paneId ? { ...tree, tabs: [], activeTabId: null } : tree
  }
  return removePane(tree, paneId) ?? tree
}

/**
 * Closes every tab that shows `noteId`, in every pane. A deleted note must not
 * leave a tab pointing at a document that no longer exists.
 */
export function closeNote(tree: PaneTree, noteId: string): PaneTree {
  let next = tree
  for (;;) {
    const where = findNote(next, noteId)
    if (!where) return next
    next = closeTab(next, where.paneId, where.tabId)
  }
}

export function closeOtherTabs(tree: PaneTree, paneId: string, keepTabId: string): PaneTree {
  return mapPane(tree, paneId, (pane) => {
    const kept = pane.tabs.find((tab) => tab.id === keepTabId)
    if (!kept) return pane
    if (pane.tabs.length === 1 && pane.activeTabId === keepTabId) return pane
    return { ...pane, tabs: [kept], activeTabId: kept.id }
  })
}

/**
 * Splits `paneId` and opens a copy of its active tab in the new pane, so a
 * split never starts empty: you see the same page twice and can then pick a
 * different file for either side. Both views share one Yjs document (see
 * `lib/collab/noteSession`), so this is not two editors fighting.
 */
export function splitPaneWithActiveTab(
  tree: PaneTree,
  paneId: string,
  direction: SplitDirection,
  ids: { paneId: string; tabId: string; splitId: string }
): PaneTree {
  const source = findPane(tree, paneId)
  if (!source) return tree
  const tab = activeTab(source)
  const copy = singlePane(ids.paneId, tab?.noteId ?? null, ids.tabId)
  return splitPane(tree, paneId, direction, copy, ids.splitId)
}

/** Splits `paneId` and places `newPane` after it: right or below. */
export function splitPane(
  tree: PaneTree,
  paneId: string,
  direction: SplitDirection,
  newPane: PaneLeaf,
  splitId: string
): PaneTree {
  return mapPane(tree, paneId, (pane) => ({
    kind: 'split',
    id: splitId,
    direction,
    ratio: DEFAULT_RATIO,
    first: pane,
    second: newPane,
  }))
}

export function setRatio(tree: PaneTree, splitId: string, ratio: number): PaneTree {
  return mapSplit(tree, splitId, (split) => {
    const value = clampRatio(ratio)
    return value === split.ratio ? split : { ...split, ratio: value }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Tabs of one pane. A note may appear in several panes (they share a single
 * Yjs document), but twice in the same pane would only be confusing.
 */
function sanitizeTabs(value: unknown): PaneTab[] | null {
  if (!Array.isArray(value)) return null
  const seenIds = new Set<string>()
  const seenNotes = new Set<string>()
  const tabs: PaneTab[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.noteId)) return null
    if (seenIds.has(entry.id) || seenNotes.has(entry.noteId)) continue
    seenIds.add(entry.id)
    seenNotes.add(entry.noteId)
    tabs.push({ id: entry.id, noteId: entry.noteId })
  }
  return tabs
}

/**
 * Validates a layout read from localStorage. Garbage is rejected (`null`), while
 * small inconsistencies (a dangling active tab, a duplicated tab) are repaired
 * instead of throwing the whole session away.
 */
export function sanitizeLayout(value: unknown): PaneTree | null {
  const paneIds = new Set<string>()
  const seenSplitIds = new Set<string>()

  const walk = (node: unknown, depth: number): PaneTree | null => {
    if (depth > MAX_DEPTH || !isRecord(node)) return null
    if (node.kind === 'pane') {
      if (!nonEmptyString(node.id) || paneIds.has(node.id)) return null
      const tabs = sanitizeTabs(node.tabs)
      if (!tabs) return null
      paneIds.add(node.id)
      const activeTabId =
        typeof node.activeTabId === 'string' && tabs.some((tab) => tab.id === node.activeTabId)
          ? node.activeTabId
          : (tabs[0]?.id ?? null)
      return { kind: 'pane', id: node.id, tabs, activeTabId }
    }
    if (node.kind === 'split') {
      if (!nonEmptyString(node.id) || seenSplitIds.has(node.id)) return null
      if (node.direction !== 'row' && node.direction !== 'column') return null
      seenSplitIds.add(node.id)
      const first = walk(node.first, depth + 1)
      const second = walk(node.second, depth + 1)
      if (!first || !second) return null
      return {
        kind: 'split',
        id: node.id,
        direction: node.direction,
        ratio: clampRatio(typeof node.ratio === 'number' ? node.ratio : DEFAULT_RATIO),
        first,
        second,
      }
    }
    return null
  }

  return walk(value, 0)
}
