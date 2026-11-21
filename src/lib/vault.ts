import type { Folder, Note } from './notes'
import { noteToMarkdown, safeFileName, zipStored } from './export'
import { unzip } from './unzip'

/**
 * Obsidian vault <-> FireMD.
 *
 * A vault is a folder of `.md` files plus a `.obsidian/` config directory.
 * FireMD folders are one level deep, so importing a nested vault flattens it:
 * the first path segment becomes the folder, deeper segments stay in the file
 * name. Attachments (images, PDFs) are not supported yet — they are reported,
 * never silently dropped.
 */

const IGNORED_PREFIXES = ['.obsidian/', '.trash/', '.git/', '.mdfire/']
const MAX_MARKDOWN_BYTES = 250_000
const OBSIDIAN_MINIMAL_APP_JSON = '{}\n'

export interface VaultEntry {
  path: string
  folder: string | null
  title: string
  markdown: string
}

export interface VaultImport {
  entries: VaultEntry[]
  skipped: { path: string; reason: 'attachment' | 'too-large' | 'not-markdown' }[]
}

function titleFromPath(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

export function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return (heading || fallback).slice(0, 300) || 'Sin título'
}

/** Reads a vault ZIP and turns it into notes + folder names. */
export async function readVault(zipBytes: Uint8Array): Promise<VaultImport> {
  const files = await unzip(zipBytes)
  const decoder = new TextDecoder()
  const entries: VaultEntry[] = []
  const skipped: VaultImport['skipped'] = []

  for (const file of files) {
    const path = file.path.replace(/\\/g, '/')
    if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
    if (path.startsWith('.')) continue

    const isMarkdown = /\.(md|markdown)$/i.test(path)
    if (!isMarkdown) {
      skipped.push({ path, reason: 'attachment' })
      continue
    }
    if (file.bytes.byteLength > MAX_MARKDOWN_BYTES) {
      skipped.push({ path, reason: 'too-large' })
      continue
    }

    const markdown = decoder.decode(file.bytes)
    const segments = path.split('/')
    const folder = segments.length > 1 ? safeFileName(segments[0], 'carpeta') : null

    entries.push({
      path,
      folder,
      title: titleFromMarkdown(markdown, titleFromPath(path)),
      markdown,
    })
  }

  return { entries, skipped }
}

export interface VaultExport {
  bytes: Uint8Array
  fileName: string
  notes: number
  folders: number
}

/** Builds a ZIP Obsidian can open directly: notes in folders + `.obsidian/`. */
export function buildVault(
  notes: Note[],
  folders: Folder[],
  now = new Date()
): VaultExport {
  const folderName = new Map(folders.map((f) => [f.id, safeFileName(f.name, 'carpeta')]))
  const used = new Set<string>()
  const files = [{ name: '.obsidian/app.json', content: OBSIDIAN_MINIMAL_APP_JSON }]

  const ordered = [...notes].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  for (const note of ordered) {
    const dir = note.folderId ? `${folderName.get(note.folderId) ?? 'carpeta'}/` : ''
    const base = safeFileName(note.title)
    let name = `${dir}${base}.md`
    let counter = 2
    while (used.has(name.toLowerCase())) {
      name = `${dir}${base} ${counter}.md`
      counter++
    }
    used.add(name.toLowerCase())
    files.push({ name, content: noteToMarkdown(note) })
  }

  return {
    bytes: zipStored(files, now),
    fileName: `mdfire-vault-${now.toISOString().slice(0, 10)}.zip`,
    notes: notes.length,
    folders: new Set(notes.map((n) => n.folderId).filter(Boolean)).size,
  }
}
