import { describe, expect, it } from 'vitest'
import { migrateLegacyKeys } from '../src/lib/storage'

/** Storage mínimo: lo que usa el migrador y nada más. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  } as Storage
}

describe('migrateLegacyKeys', () => {
  it('copia las claves con el nombre viejo al prefijo nuevo', () => {
    const storage = fakeStorage({
      'mdfire-active': 'nota-1',
      'mdfire.canvas.snap': '{"x":1}',
      'otra-cosa': 'queda',
    })

    expect(migrateLegacyKeys(storage).sort()).toEqual(['firemd-active', 'firemd.canvas.snap'])

    expect(storage.getItem('firemd-active')).toBe('nota-1')
    expect(storage.getItem('firemd.canvas.snap')).toBe('{"x":1}')
    // Lo que no lleva el prefijo no se toca.
    expect(storage.getItem('otra-cosa')).toBe('queda')
    expect(storage.getItem('firemd-otra-cosa')).toBeNull()
  })

  it('deja las claves viejas en su sitio, para poder volver atrás', () => {
    const storage = fakeStorage({ 'mdfire-tags': 'a,b' })
    migrateLegacyKeys(storage)
    expect(storage.getItem('mdfire-tags')).toBe('a,b')
  })

  it('no pisa una preferencia nueva con una vieja', () => {
    const storage = fakeStorage({ 'mdfire-tags': 'viejo', 'firemd-tags': 'nuevo' })
    expect(migrateLegacyKeys(storage)).toEqual([])
    expect(storage.getItem('firemd-tags')).toBe('nuevo')
  })

  it('es idempotente: la segunda pasada no mueve nada', () => {
    const storage = fakeStorage({ 'mdfire-tags': 'a,b' })
    migrateLegacyKeys(storage)
    expect(migrateLegacyKeys(storage)).toEqual([])
  })

  it('sin claves viejas no hace nada', () => {
    const storage = fakeStorage({ 'firemd-tags': 'a,b' })
    expect(migrateLegacyKeys(storage)).toEqual([])
  })
})
