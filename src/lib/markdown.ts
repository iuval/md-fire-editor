/**
 * The editor owns the body; the frontmatter is kept aside and re-attached.
 *
 * ProseMirror has no concept of YAML frontmatter: `---` becomes a horizontal
 * rule and `key: value` lines become a paragraph, so round-tripping a note with
 * properties through the editor destroyed them. Splitting keeps the frontmatter
 * byte-identical while the body is edited.
 */

export interface SplitMarkdown {
  /** Opening `---` through the closing fence, **without** the newline after it. */
  frontmatter: string
  /** Everything after the closing fence, usually starting with a blank line. */
  body: string
}

export function splitFrontmatter(markdown: string): SplitMarkdown {
  if (!markdown.startsWith('---')) return { frontmatter: '', body: markdown }

  const match = /\n---[ \t]*(?=\r?\n|$)/.exec(markdown)
  if (!match) return { frontmatter: '', body: markdown }

  // `match[0]` ends right after the closing fence, so the newline that follows
  // belongs to the body: `frontmatter + body` reproduces the original exactly.
  const end = match.index + match[0].length
  return { frontmatter: markdown.slice(0, end), body: markdown.slice(end) }
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body
  if (!body) return frontmatter
  return body.startsWith('\n') ? `${frontmatter}${body}` : `${frontmatter}\n${body}`
}

/** Title derived from the first H1, else the first non-empty line. */
export function titleFromMarkdown(markdown: string, fallback = 'Sin título'): string {
  const { body } = splitFrontmatter(markdown)
  for (const line of body.split('\n')) {
    const clean = line
      .replace(/^#{1,6}\s*/, '')
      .replace(/[*_`>[\]]/g, '')
      .trim()
    if (clean && clean !== '---') return clean.slice(0, 300)
  }
  return fallback
}

/**
 * Comparison form for "did anything actually change?".
 *
 * The editor's serializer drops the trailing newline and normalizes line
 * endings, so byte equality is too strict: without this, opening a note looks
 * like an edit and its `updatedAt` (and the sidebar order) changes.
 */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '')
}

/**
 * Same question as `normalizeMarkdown(a) === normalizeMarkdown(b)`, without the
 * two full copies and without allocating a single object.
 *
 * It runs on every edit (the editor asks "did anything really change?" before
 * emitting, and the save path asks again before writing), and normalising a
 * 100 KB body twice to answer it cost ~0.85 ms plus two copies of the body.
 * This walks both strings once, skipping exactly what `normalizeMarkdown`
 * strips: the `\r` of a `\r\n` pair, spaces and tabs before a newline, and
 * trailing whitespace at the end.
 */
export function sameMarkdown(a: string, b: string): boolean {
  if (a === b) return true

  const endA = contentEnd(a)
  const endB = contentEnd(b)
  let i = 0
  let j = 0

  for (;;) {
    // Fast path: everything normalisation cannot touch is compared in place,
    // with no function call per character (a 100 KB body is 100k characters).
    for (;;) {
      if (i >= endA || j >= endB) return i >= endA && j >= endB
      const code = a.charCodeAt(i)
      if (code !== b.charCodeAt(j)) break
      if (code === SPACE || code === TAB || code === CR || code === LF) break
      i++
      j++
    }

    // Skip padding on both sides, then compare the next significant character.
    i = nextSignificant(a, i, endA)
    j = nextSignificant(b, j, endB)
    if (i >= endA || j >= endB) return i >= endA && j >= endB
    if (a.charCodeAt(i) !== b.charCodeAt(j)) return false
    i++
    j++
  }
}

const TAB = 9
const LF = 10
const CR = 13
const SPACE = 32
const VT = 11
const FF = 12

const isWhitespace = (code: number): boolean =>
  code === SPACE || code === TAB || code === LF || code === CR || code === VT || code === FF

/** Index after the last non-whitespace character (`/\s+$/`). */
function contentEnd(text: string): number {
  let end = text.length
  while (end > 0 && isWhitespace(text.charCodeAt(end - 1))) end--
  return end
}

/**
 * Index of the next character that survives normalisation, starting at `from`.
 *
 * A lone `\r` is content (normalisation only rewrites the pair), so only the
 * `\r` of a `\r\n` is skipped.
 */
function nextSignificant(text: string, from: number, end: number): number {
  let i = from
  while (i < end) {
    const code = text.charCodeAt(i)
    if (code === CR && i + 1 < end && text.charCodeAt(i + 1) === LF) {
      i++
      continue
    }
    if (code === SPACE || code === TAB) {
      let run = i
      while (run < end && (text.charCodeAt(run) === SPACE || text.charCodeAt(run) === TAB)) run++
      // Whitespace before a newline (or at the end of the content) is padding.
      if (run >= end || text.charCodeAt(run) === LF) {
        i = run
        continue
      }
    }
    return i
  }
  return end
}

/**
 * One-line summary for the sidebar.
 *
 * The sidebar used to strip markdown punctuation from the *whole* file, so a
 * note with properties showed `19/11 · status: en curso prioridad: alta` — raw
 * YAML where the first sentence should be. Frontmatter and a leading H1 (which
 * repeats the title shown right above it) are dropped before the text is
 * flattened.
 */
export function notePreview(markdown: string, max = 56): string {
  const { body } = splitFrontmatter(markdown)
  const withoutHeading = body.replace(/^\s{0,3}#\s+.*(\r?\n|$)/, '')
  return withoutHeading
    .replace(/[#*`[\]!>_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}
