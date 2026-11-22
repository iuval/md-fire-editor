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

/** A tab anywhere in the tree: the pane it lives in and its id. */
export interface TabRef {
  paneId: string
  tabId: string
}

/** The side a dropped tab splits a pane from. */
export type DropSide = 'left' | 'right' | 'top' | 'bottom'

function findTab(tree: PaneTree, ref: TabRef): { pane: PaneLeaf; tab: PaneTab } | null {
  const pane = findPane(tree, ref.paneId)
  const tab = pane?.tabs.find((candidate) => candidate.id === ref.tabId)
  return pane && tab ? { pane, tab } : null
}

/**
 * Takes one tab out of its pane, activating the neighbour a close would: the
 * next tab, else the previous one. The pane is left in place even when that
 * empties it, so a move can put the tab somewhere before the empty pane has to
 * be pruned (see `pruneEmptyPanes`).
 */
function removeTab(tree: PaneTree, ref: TabRef): PaneTree {
  return mapPane(tree, ref.paneId, (pane) => {
    const index = pane.tabs.findIndex((tab) => tab.id === ref.tabId)
    if (index < 0) return pane
    const tabs = pane.tabs.filter((tab) => tab.id !== ref.tabId)
    const nextActive =
      pane.activeTabId === ref.tabId
        ? (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null
        : pane.activeTabId
    return { ...pane, tabs, activeTabId: nextActive }
  })
}

/**
 * Collapses every empty pane into its sibling, so a tab that moved away does not
 * leave a blank half behind. The workspace's last pane is kept even when empty:
 * there has to be somewhere to open the next file.
 */
export function pruneEmptyPanes(tree: PaneTree): PaneTree {
  if (tree.kind === 'pane') return tree
  const first = pruneEmptyPanes(tree.first)
  const second = pruneEmptyPanes(tree.second)
  const firstEmpty = first.kind === 'pane' && first.tabs.length === 0
  const secondEmpty = second.kind === 'pane' && second.tabs.length === 0
  if (firstEmpty !== secondEmpty) return firstEmpty ? second : first
  if (first === tree.first && second === tree.second) return tree
  return { ...tree, first, second }
}

export function closeTab(tree: PaneTree, paneId: string, tabId: string): PaneTree {
  const pane = findPane(tree, paneId)
  if (!pane || !pane.tabs.some((tab) => tab.id === tabId)) return tree

  const next = removeTab(tree, { paneId, tabId })
  const emptied = findPane(next, paneId)
  if (emptied && emptied.tabs.length > 0) return next
  // The last tab is gone: the pane goes with it, its sibling takes the space.
  return removePane(next, paneId) ?? next
}

/**
 * Moves a tab into a pane, before the tab currently at `index` (end when
 * omitted), and activates it. Order is the same whether the target is another
 * pane or the tab's own — dragging a tab along its strip is the same gesture as
 * dragging it across the workspace.
 */
export function moveTabToPane(
  tree: PaneTree,
  from: TabRef,
  toPaneId: string,
  index?: number
): PaneTree {
  const found = findTab(tree, from)
  const target = findPane(tree, toPaneId)
  if (!found || !target) return tree
  const { tab } = found

  if (from.paneId === toPaneId) {
    const fromIndex = target.tabs.indexOf(tab)
    const rest = target.tabs.filter((candidate) => candidate.id !== tab.id)
    // `index` counts the tabs as they are now, the dragged one included.
    const wanted = index === undefined ? rest.length : index > fromIndex ? index - 1 : index
    const at = Math.min(rest.length, Math.max(0, wanted))
    if (at === fromIndex && target.activeTabId === tab.id) return tree
    const tabs = at === fromIndex ? target.tabs : [...rest.slice(0, at), tab, ...rest.slice(at)]
    return mapPane(tree, toPaneId, (pane) => ({ ...pane, tabs, activeTabId: tab.id }))
  }

  const stripped = removeTab(tree, from)
  // The same note twice in one pane would only be confusing, and a reload drops
  // one of the two anyway: the tab already there wins.
  const twin = target.tabs.find((candidate) => candidate.noteId === tab.noteId)
  const moved = mapPane(stripped, toPaneId, (pane) => {
    if (twin) return { ...pane, activeTabId: twin.id }
    const at = Math.min(pane.tabs.length, Math.max(0, index ?? pane.tabs.length))
    const tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)]
    return { ...pane, tabs, activeTabId: tab.id }
  })
  return pruneEmptyPanes(moved)
}

/**
 * Splits `targetPaneId` on `side` and puts the dragged tab alone in the new
 * pane — the tab moves, it is not copied. The source pane collapses when the tab
 * was its last one.
 */
export function moveTabToNewPane(
  tree: PaneTree,
  from: TabRef,
  targetPaneId: string,
  side: DropSide,
  ids: { paneId: string; splitId: string }
): PaneTree {
  const found = findTab(tree, from)
  const target = findPane(tree, targetPaneId)
  if (!found || !target) return tree
  // Splitting a pane against its own only tab would collapse straight back into
  // one pane. Doing it would only re-mount the editor for nothing.
  if (from.paneId === targetPaneId && target.tabs.length === 1) return tree

  const newPane: PaneLeaf = {
    kind: 'pane',
    id: ids.paneId,
    tabs: [{ id: found.tab.id, noteId: found.tab.noteId }],
    activeTabId: found.tab.id,
  }
  const direction: SplitDirection = side === 'left' || side === 'right' ? 'row' : 'column'
  const first = side === 'left' || side === 'top'

  const split = mapPane(removeTab(tree, from), targetPaneId, (pane) => ({
    kind: 'split' as const,
    id: ids.splitId,
    direction,
    ratio: DEFAULT_RATIO,
    first: first ? newPane : pane,
    second: first ? pane : newPane,
  }))
  return pruneEmptyPanes(split)
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
