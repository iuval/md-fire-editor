import { describe, expect, it } from 'vitest'
import {
  coerceValue,
  formatPropertyValue,
  inferType,
  parseProperties,
  setProperty,
} from '../src/lib/properties'

describe('property types', () => {
  it('infers the type from the written value', () => {
    expect(inferType('hola')).toBe('text')
    expect(inferType('42')).toBe('number')
    expect(inferType('-3.5')).toBe('number')
    expect(inferType('2026-01-15')).toBe('date')
    expect(inferType('2026-01-15T10:30')).toBe('date')
    expect(inferType('true')).toBe('checkbox')
    expect(inferType(['a', 'b'])).toBe('list')
  })

  it('coerces values to their type', () => {
    expect(coerceValue('42', 'number')).toBe(42)
    expect(coerceValue('no-numero', 'number')).toBe(0)
    expect(coerceValue('true', 'checkbox')).toBe(true)
    expect(coerceValue('a, b', 'list')).toEqual(['a', 'b'])
    expect(coerceValue('2026-01-15', 'date')).toBe('2026-01-15')
  })

  it('formats for display', () => {
    expect(formatPropertyValue({ key: 'k', type: 'checkbox', value: true })).toBe('sí')
    expect(formatPropertyValue({ key: 'k', type: 'list', value: ['a', 'b'] })).toBe('a, b')
  })
})

describe('parsing frontmatter properties', () => {
  it('reads typed values and skips tags', () => {
    const md = [
      '---',
      'tags: [producto]',
      'estado: en curso',
      'prioridad: 3',
      'vence: 2026-12-01',
      'hecho: false',
      'autores:',
      '  - ana',
      '  - bruno',
      '---',
      '',
      '# Nota',
    ].join('\n')

    expect(parseProperties(md)).toEqual([
      { key: 'estado', type: 'text', value: 'en curso' },
      { key: 'prioridad', type: 'number', value: 3 },
      { key: 'vence', type: 'date', value: '2026-12-01' },
      { key: 'hecho', type: 'checkbox', value: false },
      { key: 'autores', type: 'list', value: ['ana', 'bruno'] },
    ])
  })

  it('returns nothing without frontmatter', () => {
    expect(parseProperties('# Nota\n\ncuerpo')).toEqual([])
  })
})

describe('editing properties', () => {
  it('creates frontmatter when there is none', () => {
    const out = setProperty('# Nota\n\ncuerpo', { key: 'estado', type: 'text', value: 'listo' })
    expect(out).toBe('---\nestado: listo\n---\n\n# Nota\n\ncuerpo')
  })

  it('replaces a key and preserves the rest verbatim', () => {
    const md = '---\ntags: [a]\nestado: viejo\nvence: 2026-01-01\n---\n\ncuerpo'
    const out = setProperty(md, { key: 'estado', type: 'text', value: 'nuevo' })
    expect(out).toContain('tags: [a]')
    expect(out).toContain('estado: nuevo')
    expect(out).toContain('vence: 2026-01-01')
    expect(parseProperties(out)).toEqual([
      { key: 'estado', type: 'text', value: 'nuevo' },
      { key: 'vence', type: 'date', value: '2026-01-01' },
    ])
  })

  it('rewrites a list over the old list lines', () => {
    const md = '---\nautores:\n  - ana\n  - bruno\n---\n\ncuerpo'
    const out = setProperty(md, { key: 'autores', type: 'list', value: ['carla'] })
    expect(parseProperties(out)).toEqual([{ key: 'autores', type: 'list', value: ['carla'] }])
  })

  it('removes a key and drops empty frontmatter', () => {
    const md = '---\nsolo: uno\n---\n\ncuerpo'
    expect(setProperty(md, { key: 'solo', value: null })).toBe('cuerpo')
  })

  it('round-trips a document with tags untouched', () => {
    const md = '---\ntags: [Trabajo]\ndue: 2026-02-02\n---\n\n# Hola'
    const out = setProperty(md, { key: 'due', type: 'date', value: '2026-03-03' })
    expect(out).toContain('tags: [Trabajo]')
    expect(parseProperties(out)).toEqual([{ key: 'due', type: 'date', value: '2026-03-03' }])
  })
})
