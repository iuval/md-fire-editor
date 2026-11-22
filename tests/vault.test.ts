import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildVault, planVault, readVault, streamVaultNotes } from '../src/lib/vault'
import { dirname } from 'node:path'
import type { Folder, Note } from '../src/lib/notes'

function makeVaultZip(): { zip: Uint8Array; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'))
  mkdirSync(join(dir, 'Trabajo'), { recursive: true })
  mkdirSync(join(dir, '.obsidian'), { recursive: true })
  mkdirSync(join(dir, 'Adjuntos'), { recursive: true })

  writeFileSync(join(dir, 'Ideas.md'), '# Ideas\n\n- uno #producto\n')
  writeFileSync(join(dir, 'Trabajo', 'Acta.md'), '---\ntags: [reunion]\n---\n\nsin H1\n')
  writeFileSync(join(dir, 'Trabajo', 'Reunion.md'), '# Reunión\n\n[[Ideas]] y #equipo/acme\n')
  writeFileSync(join(dir, 'Adjuntos', 'foto.png'), 'no-soy-texto')
  writeFileSync(join(dir, '.obsidian', 'app.json'), '{"legacyEditor":false}')

  const zipPath = join(dir, 'vault.zip')
  // -r deflates; -X drops extra fields. This proves we read real DEFLATE entries.
  execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', 'vault.zip'], { cwd: dir })
  return { zip: new Uint8Array(readFileSync(zipPath)), dir }
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own',
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    title: 'Ideas',
    markdown: '# Ideas\n\n- uno\n',
    tags: [],
    version: 1,
    ...overrides,
  }
}

describe('real-world vault shapes', () => {
  function buildZip(files: Record<string, string>, extraDirs: string[] = []): Uint8Array {
    const dir = mkdtempSync(join(tmpdir(), 'vault-real-'))
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    for (const path of extraDirs) mkdirSync(join(dir, path), { recursive: true })
    const zipPath = join(dir, 'v.zip')
    execFileSync('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: dir })
    return new Uint8Array(readFileSync(zipPath))
  }

  it('strips a doubled vault root and keeps the nested structure', async () => {
    const zip = buildZip({
      'ObsidianVault/ObsidianVault/Diario/2026-11-21.md': '# Día\n',
      'ObsidianVault/ObsidianVault/GUIONES/V3/acto-1.md': '# Acto 1\n',
      'ObsidianVault/ObsidianVault/suelta.md': '# Suelta\n',
    })

    const vault = await readVault(zip)
    const byPath = Object.fromEntries(vault.entries.map((e) => [e.path, e.folder]))

    expect(byPath['Diario/2026-11-21.md']).toBe('Diario')
    expect(byPath['GUIONES/V3/acto-1.md']).toBe('GUIONES/V3')
    expect(byPath['suelta.md']).toBeNull()
    expect(vault.roots).toEqual(['ObsidianVault', 'ObsidianVault'])
  })

  it('plans a vault without reading any body, then streams the notes', async () => {
    const zip = buildZip({
      'Vault/Diario/a.md': '# A\n',
      'Vault/foto.png': 'no soy markdown',
      'Vault/__MACOSX/._a.md': 'junk',
    })

    // Pass 1: paths, folder and titles only (the ZIP directory), plus what will
    // be skipped. No note body is decoded here.
    const plan = planVault(zip)
    expect(plan.notes.map((n) => n.path)).toEqual(['Diario/a.md'])
    expect(plan.notes[0].folder).toBe('Diario')
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(['attachment', 'junk'])

    // Pass 2: the bodies, one at a time.
    const streamed: string[] = []
    for await (const entry of streamVaultNotes(zip, plan)) streamed.push(`${entry.title}:${entry.markdown}`)
    expect(streamed).toEqual(['A:# A\n'])
  })

  it('keeps a single folder level instead of flattening the vault', async () => {
    const zip = buildZip({ 'Vault/Diario/a.md': '# A\n', 'Vault/Diario/b.md': '# B\n' })
    const vault = await readVault(zip)
    expect(vault.entries.map((e) => e.folder)).toEqual(['Diario', 'Diario'])
  })

  it('skips macOS resource forks, dotfiles and binary payloads, and reports them', async () => {
    const zip = buildZip({
      'Vault/Nota.md': '# Nota\n',
      'Vault/._Nota.md': '\u0000\u0005\u0016\u0007Mac OS X        ATTR',
      '__MACOSX/Vault/._Nota.md': '\u0000\u0005\u0016\u0007Mac OS X',
      'Vault/.DS_Store': '\u0000junk',
      'Vault/.obsidian/app.json': '{}',
      'Vault/foto.png': 'binary',
    })

    const vault = await readVault(zip)
    // One folder + one file: the wrapper is kept so the vault structure survives.
    expect(vault.entries.map((e) => e.path)).toEqual(['Vault/Nota.md'])
    expect(vault.entries[0].folder).toBe('Vault')

    const junk = vault.skipped.filter((s) => s.reason === 'junk').length
    expect(junk).toBeGreaterThanOrEqual(2)
    expect(vault.skipped.some((s) => s.reason === 'attachment' && s.path.endsWith('foto.png'))).toBe(true)
  })

  it('skips a __MACOSX tree nested inside the vault', async () => {
    const zip = buildZip({
      'Vault/ObsidianVault/Nota.md': '# Nota\n',
      'Vault/ObsidianVault/__MACOSX/._Nota.md': '\u0000\u0005\u0016\u0007Mac OS X',
      'Vault/__MACOSX/ObsidianVault/x.md': '\u0000\u0005\u0016\u0007Mac OS X',
    })
    const vault = await readVault(zip)
    expect(vault.entries.map((e) => e.path)).toEqual(['ObsidianVault/Nota.md'])
  })

  it('decodes UTF-8 names that lack the UTF-8 flag', async () => {
    const zip = buildZip({ 'Vault/Versión 1/acto.md': '# Acto\n' })
    const vault = await readVault(zip)
    expect(vault.entries[0].path).toBe('Versión 1/acto.md')
  })
})

describe('reading an Obsidian vault', () => {
  it('reads deflated entries, maps folders and skips config/attachments', async () => {
    const { zip } = makeVaultZip()
    const vault = await readVault(zip)

    const paths = vault.entries.map((e) => e.path).sort()
    expect(paths).toEqual(['Ideas.md', 'Trabajo/Acta.md', 'Trabajo/Reunion.md'])

    const acta = vault.entries.find((e) => e.path === 'Trabajo/Acta.md')!
    expect(acta.folder).toBe('Trabajo')
    expect(acta.title).toBe('Acta') // no H1 → file name
    expect(acta.markdown).toContain('tags: [reunion]')

    const reunion = vault.entries.find((e) => e.path === 'Trabajo/Reunion.md')!
    expect(reunion.title).toBe('Reunión') // H1 wins over file name
    expect(reunion.markdown).toContain('[[Ideas]]')

    expect(vault.skipped.map((s) => s.path).sort()).toEqual(['Adjuntos/foto.png'])
    expect(vault.skipped[0].reason).toBe('attachment')
  })

  it('rejects a file that is not a ZIP', async () => {
    await expect(readVault(new TextEncoder().encode('no soy un zip'))).rejects.toThrow(/ZIP/i)
  })
})

describe('building a vault', () => {
  it('produces a ZIP that our own reader and unzip accept', async () => {
    const folders: Folder[] = [
      { id: 'f1', ownerId: 'u1', name: 'Trabajo', tags: [], memberIds: ['u1'], roles: { u1: 'owner' }, access: 'restricted' },
    ]
    const vault = buildVault(
      [note(), note({ id: 'n2', title: 'Acta', folderId: 'f1', markdown: '# Acta\n\nhola\n' })],
      folders
    )

    expect(vault.fileName).toMatch(/^mdfire-vault-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(vault.notes).toBe(2)

    const dir = mkdtempSync(join(tmpdir(), 'vault-out-'))
    const file = join(dir, 'out.zip')
    writeFileSync(file, Buffer.from(await vault.blob.arrayBuffer()))
    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' })
    expect(listing).toContain('Ideas.md')
    expect(listing).toContain('Trabajo/Acta.md')
    expect(listing).toContain('.obsidian/app.json')

    const back = await readVault(new Uint8Array(await vault.blob.arrayBuffer()))
    expect(back.entries.map((e) => e.path).sort()).toEqual(['Ideas.md', 'Trabajo/Acta.md'])
  })
})
