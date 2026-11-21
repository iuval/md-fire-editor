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

/**
 * Obsidian keeps the case you typed and groups case-insensitively, so the tag is
 * stored as written and compared through `tagKey`.
 */
export function normalizeTag(raw: string): string | null {
  const clean = String(raw)
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')

  // Obsidian requires at least one non-numerical character: `#123` is not a tag.
  if (!clean || clean.length > MAX_TAG_LENGTH || !/\p{L}/u.test(clean)) return null
  return clean
}

/** Comparison key: tags are case-insensitive but displayed as typed. */
export function tagKey(tag: string): string {
  return tag.toLowerCase()
}

export function sameTag(a: string, b: string): boolean {
  return tagKey(a) === tagKey(b)
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
  const found = new Map<string, string>() // lower-case key -> display form

  const add = (raw: string) => {
    const normalized = normalizeTag(raw)
    if (!normalized) return
    const key = tagKey(normalized)
    if (!found.has(key)) found.set(key, normalized)
  }

  for (const tag of frontmatterTags(markdown)) add(tag)
  for (const match of withoutCode.matchAll(INLINE_TAG)) add(match[2])

  return Array.from(found.values())
    .sort((a, b) => tagKey(a).localeCompare(tagKey(b)))
    .slice(0, MAX_TAGS)
}

/** Validates a user-provided tag list (folder tags are edited by hand). */
export function parseTagInput(input: string): string[] {
  const parts = String(input)
    .split(/[,\s]+/)
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => !!tag)

  const unique = new Map<string, string>()
  for (const tag of parts) {
    const key = tagKey(tag)
    if (!unique.has(key)) unique.set(key, tag)
  }
  return Array.from(unique.values())
    .sort((a, b) => tagKey(a).localeCompare(tagKey(b)))
    .slice(0, MAX_TAGS)
}

export interface TagNode {
  /** Lower-case key, also the filter value. */
  key: string
  /** Display form as typed by the user. */
  display: string
  count: number
  depth: number
}

/**
 * Flattens tags into a tree ordered like Obsidian's tag pane: `clientes`
 * followed by its children, counts include descendants.
 */
export function buildTagTree(notes: Array<{ tags: string[] }>): TagNode[] {
  const totals = new Map<string, { display: string; count: number }>()
  const bump = (key: string, display: string) => {
    const current = totals.get(key)
    if (current) current.count++
    else totals.set(key, { display, count: 1 })
  }

  for (const note of notes) {
    const seen = new Set<string>()
    for (const tag of note.tags) {
      const parts = tag.split('/')
      // Count the tag itself and every ancestor once per note.
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join('/')
        const key = path.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        bump(key, path)
      }
    }
  }

  return Array.from(totals.entries())
    .map(([key, { display, count }]) => ({ key, display, count, depth: key.split('/').length - 1 }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** True when a note carries the selected tag or any tag nested under it. */
export function matchesTagFilter(noteTags: string[], selected: string[]): boolean {
  if (selected.length === 0) return true
  return selected.every((key) =>
    noteTags.some((tag) => {
      const lower = tag.toLowerCase()
      return lower === key || lower.startsWith(`${key}/`)
    })
  )
}
