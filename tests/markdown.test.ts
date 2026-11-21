import { describe, expect, it } from 'vitest'
import { joinFrontmatter, notePreview, splitFrontmatter, titleFromMarkdown } from '../src/lib/markdown'

const withFrontmatter = '---\ntags: [proyecto]\nestado: en curso\n---\n\n# Nota\n\ncuerpo\n'

describe('frontmatter splitting', () => {
  it('separates the YAML block from the body, byte for byte', () => {
    const { frontmatter, body } = splitFrontmatter(withFrontmatter)
    expect(frontmatter).toBe('---\ntags: [proyecto]\nestado: en curso\n---')
    expect(body).toBe('\n\n# Nota\n\ncuerpo\n')
    expect(joinFrontmatter(frontmatter, body)).toBe(withFrontmatter)
  })

  it('leaves documents without frontmatter untouched', () => {
    expect(splitFrontmatter('# Hola\n')).toEqual({ frontmatter: '', body: '# Hola\n' })
    // A horizontal rule in the middle of the text is not frontmatter.
    const md = '# Hola\n\n---\n\ntexto\n'
    expect(splitFrontmatter(md)).toEqual({ frontmatter: '', body: md })
  })

  it('handles an empty frontmatter block and a missing body', () => {
    expect(splitFrontmatter('---\n---\ncuerpo')).toEqual({ frontmatter: '---\n---', body: '\ncuerpo' })
    expect(splitFrontmatter('---\na: 1\n---\n').body).toBe('\n')
    expect(joinFrontmatter('---\na: 1\n---', '')).toBe('---\na: 1\n---')
  })

  it('round-trips exactly, which is what stops properties from being lost', () => {
    const docs = [
      withFrontmatter,
      '---\ndue: 2026-01-01\nlista:\n  - a\n  - b\n---\n# T\n',
      'sin frontmatter\n',
      '---\n---\n',
    ]
    for (const doc of docs) {
      const parts = splitFrontmatter(doc)
      expect(joinFrontmatter(parts.frontmatter, parts.body)).toBe(doc)
    }
  })

  it('derives a title ignoring the frontmatter', () => {
    expect(titleFromMarkdown(withFrontmatter)).toBe('Nota')
    expect(titleFromMarkdown('---\na: 1\n---\n\nprimera línea\n')).toBe('primera línea')
    expect(titleFromMarkdown('---\na: 1\n---\n')).toBe('Sin título')
  })
})

describe('sidebar preview', () => {
  it('never shows YAML frontmatter', () => {
    expect(notePreview(withFrontmatter)).toBe('cuerpo')
  })

  it('skips the leading H1 that repeats the note title', () => {
    expect(notePreview('# Título\n\nLa primera frase de verdad.')).toBe('La primera frase de verdad.')
  })

  it('keeps a heading that is not the first line', () => {
    expect(notePreview('intro\n\n# Sección\n\ntexto')).toBe('intro Sección texto')
  })

  it('collapses whitespace and clips', () => {
    expect(notePreview('a\n\n\n  b   c')).toBe('a b c')
    expect(notePreview('x'.repeat(80), 10)).toBe('xxxxxxxxxx')
  })

  it('is empty for an empty or frontmatter-only note', () => {
    expect(notePreview('')).toBe('')
    expect(notePreview('---\na: 1\n---\n')).toBe('')
  })
})
