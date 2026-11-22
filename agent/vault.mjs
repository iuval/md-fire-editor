// Vault sync: mirror the notes as .md files on disk (Obsidian-compatible).
//
// Local-first, but the server stays authoritative: every push carries the etag
// the file had when it was pulled, so a stale file can never overwrite a newer
// remote edit — it becomes a `<name>.conflicto-YYYYMMDD-HHMM.md` next to it.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { AgentError, listNotes, readNote, replaceNote, resolveFolder, resolveNote } from './core.mjs'

const MANIFEST = '.firemd/manifest.json'
// The app used to be called mdfire. A vault synced before the rename has its
// manifest one directory over; reading it means the next push still recognises
// the files it already uploaded instead of re-creating them as duplicates.
const LEGACY_MANIFEST = '.mdfire/manifest.json'

export function safeName(name, fallback = 'sin-titulo') {
  const clean = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return clean || fallback
}

export function defaultDir() {
  return join(homedir(), 'firemd-vault')
}

export async function readManifest(dir) {
  for (const path of [MANIFEST, LEGACY_MANIFEST]) {
    try {
      return JSON.parse(await readFile(join(dir, path), 'utf8'))
    } catch {
      // Missing or corrupt: try the next location.
    }
  }
  return { version: 1, files: {} }
}

async function writeManifest(dir, manifest) {
  await mkdir(join(dir, '.firemd'), { recursive: true })
  await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function listMarkdown(dir, base = dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await listMarkdown(full, base, out)
    // Canvases are vault files too; anything else is not a note.
    else if (/\.(md|canvas)$/i.test(entry.name)) out.push(relative(base, full))
  }
  return out
}

/** Cloud → disk. Returns the number of files written. */
export async function pull(db, { dir = defaultDir(), prune = false } = {}) {
  const target = resolve(dir)
  await mkdir(target, { recursive: true })

  const folders = new Map()
  // Folder names are needed for the path, and listNotes already resolves them.
  const listing = await listNotes(db, { limit: 200 })
  const notes = listing ? listing.split('\n').map((line) => line.split('\t')) : []

  const manifest = await readManifest(target)
  const nextManifest = { version: 1, files: {} }
  let written = 0

  for (const [short, title, , folderName] of notes) {
    const note = await readNote(db, short)
    const folder = folderName && folderName !== '-' ? safeName(folderName) : ''
    const extension = note.kind === 'canvas' ? '.canvas' : '.md'
    const file = join(folder, `${safeName(note.title || title)}${extension}`)
    const full = join(target, file)

    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, note.body)
    nextManifest.files[file] = { id: note.id, etag: note.etag, path: file }
    written++
  }

  // Keep entries for notes that were not listed (shared with the agent later).
  for (const [file, entry] of Object.entries(manifest.files ?? {})) {
    if (!nextManifest.files[file]) {
      if (prune) continue
      nextManifest.files[file] = entry
    }
  }

  await writeManifest(target, nextManifest)
  return { written, dir: target, folders: folders.size }
}

/** Disk → cloud. Only files the agent can already see are pushed. */
export async function push(db, { dir = defaultDir() } = {}) {
  const target = resolve(dir)
  const manifest = await readManifest(target)
  const files = await listMarkdown(target)
  const result = { updated: 0, unchanged: 0, conflicts: [], created: [], errors: [] }

  for (const file of files) {
    const full = join(target, file)
    const entry = manifest.files?.[file]
    const info = await stat(full)
    const content = await readFile(full, 'utf8')

    const isCanvas = /\.canvas$/i.test(file)
    if (!entry) {
      // A new file can only land inside a folder the agent can write to.
      const segments = file.split('/')
      if (segments.length < 2) {
        result.errors.push(`${file}: creá la nota desde la app (el agente no puede crear notas sueltas)`)
        continue
      }
      try {
        const folder = await resolveFolder(db, segments[0])
        const { createNote } = await import('./core.mjs')
        const created = await createNote(db, {
          title: isCanvas
            ? file.replace(/\.canvas$/i, '').split('/').pop()
            : (content.match(/^#\s+(.+)$/m)?.[1] ?? file.replace(/\.md$/i, '')),
          folder: folder.id,
          body: content,
          kind: isCanvas ? 'canvas' : 'note',
        })
        manifest.files[file] = { id: created.id, etag: null, path: file }
        result.created.push(file)
      } catch (error) {
        result.errors.push(`${file}: ${error.message}`)
      }
      continue
    }

    const stamp = entry.mtime ?? 0
    if (info.mtimeMs <= stamp) {
      result.unchanged++
      continue
    }

    try {
      const note = await replaceNote(db, entry.id, content, {
        etag: entry.etag ?? undefined,
        canvas: isCanvas,
      })
      manifest.files[file] = { id: note.id, etag: note.etag, path: file, mtime: info.mtimeMs }
      result.updated++
    } catch (error) {
      if (error instanceof AgentError && error.code === 'E_ETAG') {
        // Keep the local work: never discard it silently.
        const stampDate = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '').slice(0, 12)
        const conflictFile = isCanvas
          ? file.replace(/\.canvas$/i, `.conflicto-${stampDate}.canvas`)
          : file.replace(/\.md$/i, `.conflicto-${stampDate}.md`)
        await writeFile(join(target, conflictFile), content)
        result.conflicts.push({ file, conflict: conflictFile })
        continue
      }
      result.errors.push(`${file}: ${error.message}`)
    }
  }

  await writeManifest(target, manifest)
  return result
}
