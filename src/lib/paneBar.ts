export interface PaneBarNeeds {
  /** The focused pane's tab strip is hosted by the bar (single-pane layout). */
  hasTabs: boolean
  isMobile: boolean
  sidebarCollapsed: boolean
  selectedTags: number
  presence: number
}

/**
 * The top bar is a container, not chrome: it is rendered only when something
 * needs a home up there. A split workspace keeps its tabs in each pane, so with
 * the panel open and no filter it has nothing to show and takes no height.
 */
export function paneBarNeeded({
  hasTabs,
  isMobile,
  sidebarCollapsed,
  selectedTags,
  presence,
}: PaneBarNeeds): boolean {
  return hasTabs || isMobile || sidebarCollapsed || selectedTags > 0 || presence > 0
}
