/**
 * `file` cards and Obsidian's vault paths.
 *
 * The JSON keeps the path Obsidian wrote (`carpeta/nota.md`) because that is
 * what makes the file portable; the app is what needs a note id. Resolution
 * happens on read, and nothing about it is stored in the `.canvas` file, so an
 * export stays Obsidian-shaped.
 */

export interface CanvasFileRef {
  id: string
  title: string
  /** Vault path with extension, e.g. `GUIONES/acto 1.md`. */
  path: string
}

/** Vault-relative, NFC, lower-case: two paths that differ by case are one file. */
export function normalizeCanvasPath(path: string): string {
  let clean = path.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '')
  clean = clean.normalize('NFC')
  if (!/\.(md|markdown|canvas)$/i.test(clean)) clean += '.md'
  return clean.toLowerCase()
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/** Path without its markdown extension, for title comparisons. */
function stem(path: string): string {
  return path.replace(/\.(md|markdown)$/i, '')
}

/**
 * Finds the note a card points at. Exact path first; then a unique title match,
 * which is what rescues a card whose note moved folders inside this app (the
 * export rewrites the path, but an older file still carries the previous one).
 */
export function resolveCanvasFile(
  refs: CanvasFileRef[],
  path: string
): CanvasFileRef | null {
  if (!refs.length) return null
  const wanted = normalizeCanvasPath(path)
  const exact = refs.find((ref) => normalizeCanvasPath(ref.path) === wanted)
  if (exact) return exact

  // Only the file name is compared: the folder came from a vault that moved.
  const wantedStem = stem(basename(wanted))
  const byTitle = refs.filter((ref) => stem(normalizeCanvasPath(ref.title || basename(ref.path))) === wantedStem)
  return byTitle.length === 1 ? byTitle[0] : null
}

/** The path written back into the file when the card is saved. */
export function canvasFilePath(ref: CanvasFileRef): string {
  return ref.path.replace(/\.(markdown)$/i, '.md')
}
