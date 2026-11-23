/**
 * Colors as the file stores them.
 *
 * JSON Canvas allows a hex string or a preset `"1".."6"` whose value each app
 * defines. Real vaults also contain `"7"` (a newer Obsidian preset) and
 * `"#ffffff"`, so a numeric value resolves through the app's CSS variables with
 * a neutral fallback, and anything else is handed to the browser as a color.
 */

/** Ids only: the label shown in the menu comes from the catalogue. */
export const CANVAS_PRESETS: { id: string }[] = [
  { id: '1' },
  { id: '2' },
  { id: '3' },
  { id: '4' },
  { id: '5' },
  { id: '6' },
]

export function canvasColor(color: string | undefined): string | undefined {
  if (!color) return undefined
  const value = color.trim()
  if (!value) return undefined
  // Presets are numbers; the fallback keeps an unknown preset visible.
  if (/^\d+$/.test(value)) return `var(--canvas-preset-${value}, var(--canvas-preset-other))`
  return value
}
