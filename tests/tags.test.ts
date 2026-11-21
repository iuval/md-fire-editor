import { describe, expect, it } from 'vitest'
import { extractTags, normalizeTag, parseTagInput, MAX_TAG_LENGTH, MAX_TAGS } from '../src/lib/tags'

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

  it('normalizes case, accents survive, duplicates collapse', () => {
    expect(extractTags('#Trabajo #trabajo #diseño')).toEqual(['diseño', 'trabajo'])
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

describe('tag normalization', () => {
  it('strips hashes, spaces and empty segments', () => {
    expect(normalizeTag('###Trabajo')).toBe('trabajo')
    expect(normalizeTag('clientes//acme/')).toBe('clientes/acme')
    expect(normalizeTag('a b')).toBe('ab')
    expect(normalizeTag('   ')).toBeNull()
  })

  it('parses a comma or space separated input', () => {
    expect(parseTagInput('trabajo, clientes/acme  ideas #Diseño')).toEqual([
      'clientes/acme',
      'diseño',
      'ideas',
      'trabajo',
    ])
  })
})
