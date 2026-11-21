/**
 * Obsidian-compatible tags.
 *
 * The markdown is the source of truth (`#tag`, `#a/b`, and `tags:` in the
 * frontmatter). Tags are derived on save and denormalized into the note so the
 * sidebar can filter without downloading every body.
 */

export const MAX_TAGS = 30
export const MAX_TAG_LENGTH = 50

const FENCED_CODE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm
const INLINE_CODE = /`[^`\n]*`/g
// A tag starts at the beginning or after whitespace/opening punctuation, and is
// followed by letters/digits/_/-/ (nested). "# Heading" does not match, and a
// "#" inside a URL is preceded by a path character so it does not match either.
const INLINE_TAG = /(^|[\s([{,;:'"])#([\p{L}\p{N}_/-]+)/gu

export function normalizeTag(raw: string): string | null {
  const clean = String(raw)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')

  // Obsidian requires at least one non-numerical character: `#123` is not a tag.
  if (!clean || clean.length > MAX_TAG_LENGTH || !/\p{L}/u.test(clean)) return null
  return clean
}

function frontmatterTags(markdown: string): string[] {
  if (!markdown.startsWith('---')) return []
  const end = markdown.indexOf('\n---', 3)
  if (end === -1) return []
  const block = markdown.slice(3, end)

  const inline = block.match(/^tags?:\s*\[(.*?)\]\s*$/m)
  if (inline) {
    return inline[1]
      .split(',')
      .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  const list = block.match(/^tags?:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)
  if (list) {
    return list[1]
      .split('\n')
      .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  // Legacy singular form: `tag: producto` (one value, may be space separated).
  const single = block.match(/^tag:[ \t]*(.+)$/m)
  if (single) {
    return single[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .split(/[,\s]+/)
      .filter(Boolean)
  }

  return []
}

/** All tags in a markdown document, normalized, deduplicated and capped. */
export function extractTags(markdown: string): string[] {
  if (!markdown) return []

  const withoutCode = markdown.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ')
  const found = new Set<string>()

  for (const tag of frontmatterTags(markdown)) {
    const normalized = normalizeTag(tag)
    if (normalized) found.add(normalized)
  }

  for (const match of withoutCode.matchAll(INLINE_TAG)) {
    const normalized = normalizeTag(match[2])
    if (normalized) found.add(normalized)
  }

  return Array.from(found).sort().slice(0, MAX_TAGS)
}

/** Validates a user-provided tag list (folder tags are edited by hand). */
export function parseTagInput(input: string): string[] {
  const parts = String(input)
    .split(/[,\s]+/)
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => !!tag)

  return Array.from(new Set(parts)).sort().slice(0, MAX_TAGS)
}
