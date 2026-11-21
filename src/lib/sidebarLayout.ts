/**
 * Sidebar geometry and width bounds.
 *
 * The panel width travels as the `--sidebar-w` CSS variable so the panel, its
 * off-canvas offset and the phone drawer all read the same number. The tree
 * indent lives here too: one nesting level must cost the same 12px everywhere.
 */

export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 240
/** Pixels the resize handle moves per arrow key. */
export const SIDEBAR_WIDTH_STEP = 16

/** Padding a row carries per nesting level; the children container adds the rest. */
export const TREE_ROW_STEP = 8
export const TREE_CONTAINER_PAD = 4
/** Total horizontal offset a folder gains per nesting level (12px, was 24px). */
export const TREE_INDENT = TREE_ROW_STEP + TREE_CONTAINER_PAD

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)))
}

/**
 * Inline `padding-left` of a tree row. Nesting compounds because every ancestor
 * children container adds `TREE_CONTAINER_PAD`.
 */
export function rowIndent(depth: number): number {
  return 6 + depth * TREE_ROW_STEP
}

/**
 * Offset of a level's vertical guide inside its children container. It lands
 * under the parent chevron, so the rail reads as coming down from the folder.
 */
export function guideIndent(depth: number): number {
  return 12 + depth * TREE_ROW_STEP
}
