import { describe, expect, it } from 'vitest'
import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  extractTags,
  normalizeTag,
  parseTagInput,
  sameTag,
  tagKey,
} from '../src/lib/tags'

describe('tag extraction', () => {
  it('finds inline tags and nested tags', () => {
    expect(extractTags('hola #trabajo y #clientes/acme')).toEqual(['clientes/acme', 'trabajo'])
  })

  it('ignores headings', () => {
    expect(extractTags('# Título\n\n## Sección\n\ntexto')).toEqual([])
  })

  it('ignores fenced and inline code', () => {
    const md = ['texto #real', '```js', 'const x = "#falso"', '```', 'y `#otro` fin'].join('\n')
    expect(extractTags(md)).toEqual(['real'])
  })

  it('ignores url fragments but still finds real tags in the line', () => {
    expect(extractTags('ver https://ejemplo.com/pagina#seccion')).toEqual([])
    expect(extractTags('ver https://ejemplo.com/pagina#seccion #real')).toEqual(['real'])
  })

  it('reads frontmatter lists and inline arrays', () => {
    expect(extractTags('---\ntags: [uno, dos]\n---\n\ncuerpo')).toEqual(['dos', 'uno'])
    expect(extractTags('---\ntags:\n  - tres\n  - cuatro\n---\n\ncuerpo')).toEqual(['cuatro', 'tres'])
  })

  it('keeps the typed case, groups case-insensitively and keeps accents', () => {
    expect(extractTags('#Trabajo #trabajo #diseño')).toEqual(['diseño', 'Trabajo'])
    expect(extractTags('#ACME y #acme/x')).toEqual(['ACME', 'acme/x'])
  })

  it('caps the number of tags', () => {
    const md = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `#t${i}`).join(' ')
    expect(extractTags(md)).toHaveLength(MAX_TAGS)
  })

  it('rejects tags made only of digits, like Obsidian', () => {
    expect(extractTags('issue #123 y #2026/a')).toEqual(['2026/a'])
  })

  it('reads the legacy singular `tag:` key', () => {
    expect(extractTags('---\ntag: producto\n---\ncuerpo')).toEqual(['producto'])
    expect(extractTags('---\ntag:\n  - uno\n  - dos\n---\ncuerpo')).toEqual(['dos', 'uno'])
  })

  it('ignores tags longer than the limit', () => {
    expect(extractTags(`#${'a'.repeat(MAX_TAG_LENGTH + 1)}`)).toEqual([])
  })
})

describe('tag identity', () => {
  it('compares case-insensitively without losing the display form', () => {
    expect(tagKey('Trabajo')).toBe('trabajo')
    expect(sameTag('ACME/x', 'acme/X')).toBe(true)
    expect(sameTag('a', 'b')).toBe(false)
  })
})

describe('tag normalization', () => {
  it('strips hashes, spaces and empty segments', () => {
    expect(normalizeTag('###Trabajo')).toBe('Trabajo')
    expect(normalizeTag('clientes//acme/')).toBe('clientes/acme')
    expect(normalizeTag('a b')).toBe('ab')
    expect(normalizeTag('   ')).toBeNull()
  })

  it('parses a comma or space separated input', () => {
    expect(parseTagInput('trabajo, clientes/acme  ideas #Diseño')).toEqual([
      'clientes/acme',
      'Diseño',
      'ideas',
      'trabajo',
    ])
  })
})

describe('tag tree', () => {
  it('counts descendants and orders like a tree', async () => {
    const { buildTagTree } = await import('../src/lib/tags')
    const tree = buildTagTree([
      { tags: ['clientes/acme', 'Trabajo'] },
      { tags: ['clientes/acme', 'clientes/beta'] },
      { tags: ['trabajo'] },
    ])

    expect(tree.map((n) => [n.key, n.count, n.depth])).toEqual([
      ['clientes', 2, 0],
      ['clientes/acme', 2, 1],
      ['clientes/beta', 1, 1],
      ['trabajo', 2, 0],
    ])
  })

  it('filters by a parent tag and by every selected tag (AND)', async () => {
    const { matchesTagFilter } = await import('../src/lib/tags')
    const note = { tags: ['clientes/acme', 'Trabajo'] }

    expect(matchesTagFilter(note.tags, [])).toBe(true)
    expect(matchesTagFilter(note.tags, ['clientes'])).toBe(true) // parent matches children
    expect(matchesTagFilter(note.tags, ['trabajo', 'clientes/acme'])).toBe(true)
    expect(matchesTagFilter(note.tags, ['trabajo', 'otra'])).toBe(false)
  })
})
