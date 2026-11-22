import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readManifest } from '../agent/vault.mjs'

const dirs: string[] = []

function vault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'firemd-manifest-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readManifest', () => {
  it('lee el manifiesto nuevo', async () => {
    const dir = vault()
    mkdirSync(join(dir, '.firemd'), { recursive: true })
    writeFileSync(
      join(dir, '.firemd', 'manifest.json'),
      JSON.stringify({ version: 1, files: { 'Ideas.md': { id: 'abc', etag: 'e1' } } })
    )

    const manifest = await readManifest(dir)
    expect(manifest.files['Ideas.md'].id).toBe('abc')
  })

  it('cae al manifiesto viejo si todavía no hay uno nuevo', async () => {
    const dir = vault()
    mkdirSync(join(dir, '.mdfire'), { recursive: true })
    writeFileSync(
      join(dir, '.mdfire', 'manifest.json'),
      JSON.stringify({ version: 1, files: { 'Ideas.md': { id: 'viejo', etag: 'e0' } } })
    )

    const manifest = await readManifest(dir)
    expect(manifest.files['Ideas.md'].id).toBe('viejo')
  })

  it('el nuevo manda cuando existen los dos', async () => {
    const dir = vault()
    mkdirSync(join(dir, '.firemd'), { recursive: true })
    mkdirSync(join(dir, '.mdfire'), { recursive: true })
    writeFileSync(
      join(dir, '.firemd', 'manifest.json'),
      JSON.stringify({ version: 1, files: { 'Ideas.md': { id: 'nuevo' } } })
    )
    writeFileSync(
      join(dir, '.mdfire', 'manifest.json'),
      JSON.stringify({ version: 1, files: { 'Ideas.md': { id: 'viejo' } } })
    )

    const manifest = await readManifest(dir)
    expect(manifest.files['Ideas.md'].id).toBe('nuevo')
  })

  it('sin manifiesto devuelve uno vacío', async () => {
    const manifest = await readManifest(vault())
    expect(manifest.version).toBe(1)
    expect(manifest.files).toEqual({})
  })
})
