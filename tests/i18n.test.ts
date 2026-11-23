import { describe, expect, it } from 'vitest'
import {
  currentLocale,
  localeTag,
  plural,
  resetI18nForTests,
  setLocale,
  t,
} from '../src/i18n/index.ts'
import { en } from '../src/i18n/en.ts'

describe('t', () => {
  it('reads a dot path from the catalogue', () => {
    expect(t('auth.signIn')).toBe('Sign in with Google')
    expect(t('app.loading')).toBe('Loading…')
  })

  it('replaces placeholders and tolerates extra params', () => {
    expect(t('sidebar.noteActions', { title: 'Recipes' })).toBe('Actions for Recipes')
    expect(t('note.deleteTitle', { title: 'Recipes', unused: 1 })).toBe('Delete "Recipes"?')
  })

  it('leaves a placeholder alone when the param is missing, instead of printing undefined', () => {
    expect(t('sidebar.noteActions')).toBe('Actions for {title}')
  })

  it('throws on a missing key in development instead of shipping [missing]', () => {
    // The compiler already blocks unknown keys; this covers a runtime path that
    // reaches the catalogue with a key the types never saw.
    expect(() => t('auth.notAKey' as never)).toThrow(/missing key/)
  })
})

describe('plural', () => {
  it('uses Intl.PluralRules rather than a hand-written suffix', () => {
    const forms = { one: '{count} note', other: '{count} notes' }
    expect(plural(1, forms)).toBe('1 note')
    expect(plural(0, forms)).toBe('0 notes')
    expect(plural(7, forms)).toBe('7 notes')
  })
})

describe('locale registry', () => {
  it('starts on English and exposes an Intl tag', () => {
    expect(currentLocale()).toBe('en')
    expect(localeTag()).toBe('en-US')
  })

  it('ignores a switch to the language already active', async () => {
    await setLocale('en')
    expect(currentLocale()).toBe('en')
    expect(t('app.loading')).toBe(en.app.loading)
  })

  it('can be reset for tests', () => {
    resetI18nForTests()
    expect(currentLocale()).toBe('en')
  })
})

describe('catalogue shape', () => {
  it('has no empty values, so a translator cannot silently blank a label', () => {
    const walk = (node: unknown, path: string): string[] => {
      if (typeof node === 'string') return node.trim() === '' ? [path] : []
      if (node && typeof node === 'object') {
        return Object.entries(node).flatMap(([key, value]) => walk(value, `${path}.${key}`))
      }
      return []
    }
    expect(walk(en, 'en')).toEqual([])
  })
})
