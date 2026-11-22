import { t } from '../i18n/index.ts'
/**
 * Typed labels, a subset of Obsidian's frontmatter properties.
 *
 * The markdown frontmatter stays the source of truth, so a vault round-trips
 * through Obsidian untouched. Types are inferred from the written value
 * (`date`, `number`, `checkbox`, `list`, `text`) and can be overridden when
 * editing, which is what turns a plain `due: 2026-01-15` into a date field.
 */

export type PropertyType = 'text' | 'number' | 'date' | 'checkbox' | 'list'

export interface Property {
  key: string
  type: PropertyType
  value: string | number | boolean | string[]
}

/** Ordered for the dropdown; labels are resolved at render time. */
export const PROPERTY_TYPES = ['text', 'number', 'date', 'checkbox', 'list'] as const

/** Labels for the UI; the serialized `sí`/`no` below is data, not text. */
export function propertyTypeLabel(type: PropertyType): string {
  if (type === 'number') return t('property.number')
  if (type === 'date') return t('property.date')
  if (type === 'checkbox') return t('property.checkbox')
  if (type === 'list') return t('property.list')
  return t('property.text')
}

/** Keys that belong to the tag system, not to generic properties. */
const RESERVED_KEYS = new Set(['tags', 'tag'])

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

export interface Frontmatter {
  /** Raw lines between the fences (without the fences themselves). */
  lines: string[]
  start: number
  end: number
}

export function findFrontmatter(markdown: string): Frontmatter | null {
  if (!markdown.startsWith('---')) return null
  const match = /\n---[ \t]*\n/.exec(markdown)
  if (!match) return null
  const start = 0
  const end = match.index + match[0].length
  return { lines: markdown.slice(4, match.index).split('\n'), start, end }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function inferType(raw: string | string[]): PropertyType {
  if (Array.isArray(raw)) return 'list'
  const value = raw.trim()
  if (value === 'true' || value === 'false') return 'checkbox'
  if (DATE_RE.test(value) || DATE_TIME_RE.test(value)) return 'date'
  if (NUMBER_RE.test(value)) return 'number'
  return 'text'
}

export function coerceValue(value: string | string[], type: PropertyType): Property['value'] {
  if (type === 'list') {
    return (Array.isArray(value) ? value : value.split(','))
      .map((item) => unquote(String(item)))
      .filter(Boolean)
  }
  const single = unquote(Array.isArray(value) ? (value[0] ?? '') : value)
  if (type === 'number') {
    const numeric = Number(single.replace(',', '.'))
    return Number.isFinite(numeric) ? numeric : 0
  }
  if (type === 'checkbox') return single === 'true'
  return single
}

/** Parses every frontmatter key except tags into typed properties. */
export function parseProperties(markdown: string): Property[] {
  const block = findFrontmatter(markdown)
  if (!block) return []

  const properties: Property[] = []
  let index = 0

  while (index < block.lines.length) {
    const line = block.lines[index]
    const match = /^([A-Za-z0-9_][\w .-]*):[ \t]*(.*)$/.exec(line)
    index++

    if (!match) continue
    const key = match[1].trim()
    if (RESERVED_KEYS.has(key)) {
      // Skip a YAML list that belongs to a reserved key.
      while (index < block.lines.length && /^[ \t]*-[ \t]+/.test(block.lines[index])) index++
      continue
    }

    const rawValue = match[2]
    if (rawValue.trim()) {
      const type = inferType(rawValue)
      properties.push({ key, type, value: coerceValue(rawValue, type) })
      continue
    }

    const items: string[] = []
    while (index < block.lines.length) {
      const item = /^[ \t]*-[ \t]*(.+)$/.exec(block.lines[index])
      if (!item) break
      items.push(unquote(item[1]))
      index++
    }
    if (items.length === 0) continue
    properties.push({ key, type: 'list', value: items })
  }

  return properties
}

function serializeValue(property: Property): string {
  if (property.type === 'list') {
    const items = Array.isArray(property.value) ? property.value : [String(property.value)]
    return `\n${items
      .filter(Boolean)
      .map((item) => `  - ${item}`)
      .join('\n')}`
  }
  if (property.type === 'checkbox') return ` ${property.value ? 'true' : 'false'}`
  if (property.type === 'number') return ` ${property.value}`
  const text = String(property.value)
  return ` ${DATE_RE.test(text) || DATE_TIME_RE.test(text) ? text : text}`
}

/**
 * Sets (or removes, with `null`) a property and returns the whole document.
 * Everything else in the frontmatter is preserved verbatim.
 */
export function setProperty(markdown: string, property: Property | { key: string; value: null }): string {
  const block = findFrontmatter(markdown)
  const key = property.key

  if (!block) {
    if ('value' in property && property.value === null) return markdown
    const line = `${key}:${serializeValue(property as Property)}`
    return `---\n${line}\n---\n\n${markdown}`
  }

  const lines = [...block.lines]
  const kept: string[] = []
  let removed = false
  let replaced = false

  const newLine = 'value' in property && property.value !== null ? `${key}:${serializeValue(property as Property)}`.split('\n') : []

  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_][\w .-]*):/.exec(lines[i])
    if (match && match[1].trim() === key) {
      removed = true
      i++
      while (i < lines.length && /^[ \t]*-[ \t]+/.test(lines[i])) i++
      i--
      // Keep the original position so editing a field does not reshuffle the block.
      if (newLine.length > 0 && !replaced) {
        kept.push(...newLine)
        replaced = true
      }
      continue
    }
    kept.push(lines[i])
  }

  if (!replaced && newLine.length > 0) kept.push(...newLine)

  const body = markdown.slice(block.end)
  if (kept.length === 0 && removed) return body.replace(/^\n+/, '')
  return `---\n${kept.join('\n')}\n---\n${body}`
}

export function formatPropertyValue(property: Property): string {
  if (property.type === 'checkbox') return property.value ? 'sí' : 'no'
  if (property.type === 'list') return (property.value as string[]).join(', ')
  return String(property.value)
}
