import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { noteToMarkdown, notesToFiles, safeFileName, zipStored } from '../src/lib/export'
import type { Folder, Note } from '../src/lib/notes'

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    ownerId: 'u1',
    folderId: null,
    aclSource: 'own',
    memberIds: ['u1'],
    roles: { u1: 'owner' },
    access: 'restricted',
    title: 'Mi nota',
    markdown: 'cuerpo\n',
    version: 1,
    ...overrides,
  }
}

describe('markdown export', () => {
  it('keeps the body when the title is already an H1', () => {
    expect(noteToMarkdown(note({ markdown: '# Mi nota\n\ncuerpo' }))).toBe('# Mi nota\n\ncuerpo\n')
  })

  it('adds an H1 when the body has no title', () => {
    expect(noteToMarkdown(note({ markdown: 'cuerpo' }))).toBe('# Mi nota\n\ncuerpo\n')
  })

  it('never emits an empty heading for untitled notes', () => {
    expect(noteToMarkdown(note({ title: '', markdown: 'cuerpo' }))).toBe('cuerpo\n')
  })

  it('sanitizes file names', () => {
    expect(safeFileName('a/b:c*d?')).toBe('a-b-c-d-')
    expect(safeFileName('   ')).toBe('untitled')
  })

  it('groups files by folder and de-duplicates names', () => {
    const folders: Folder[] = [
      { id: 'f1', ownerId: 'u1', name: 'Trabajo', memberIds: ['u1'], roles: { u1: 'owner' }, access: 'restricted' },
    ]
    const files = notesToFiles(
      [
        note({ id: 'a', title: 'Ideas' }),
        note({ id: 'b', title: 'Ideas' }),
        note({ id: 'c', title: 'Acta', folderId: 'f1' }),
      ],
      folders
    )
    const names = files.map((f) => f.name)
    expect(names).toContain('Ideas.md')
    expect(names).toContain('Ideas 2.md')
    expect(names).toContain('Trabajo/Acta.md')
  })
})

describe('zip writer', () => {
  it('produces an archive that unzip accepts', () => {
    const bytes = zipStored([
      { name: 'Ideas.md', content: '# Ideas\n\n- uno\n' },
      { name: 'Trabajo/Acta.md', content: '# Acta\n\nreunión\n' },
    ])

    const dir = mkdtempSync(join(tmpdir(), 'firemd-zip-'))
    const file = join(dir, 'out.zip')
    writeFileSync(file, bytes)

    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' })
    expect(listing).toContain('Ideas.md')
    expect(listing).toContain('Trabajo/Acta.md')

    // CRC verification: `unzip -t` fails on any mismatch.
    const test = execFileSync('unzip', ['-t', file], { encoding: 'utf8' })
    expect(test).toContain('No errors detected')

    const content = execFileSync('unzip', ['-p', file, 'Trabajo/Acta.md'], { encoding: 'utf8' })
    expect(content).toContain('reunión')
  })
})
