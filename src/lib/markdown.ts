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

export function sameMarkdown(a: string, b: string): boolean {
  return normalizeMarkdown(a) === normalizeMarkdown(b)
}
