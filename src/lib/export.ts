import type { Folder, Note } from './notes'

/**
 * Export/import in plain markdown — no dependencies.
 *
 * The ZIP writer is deliberately "stored" (no compression): notes are text,
 * browsers already gzip the download, and a dependency-free implementation is
 * auditable and testable with `unzip -t`.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

export interface ZipEntry {
  name: string
  content: string
}

interface ZipChunks {
  /** `Uint8Array<ArrayBuffer>` so the list is a valid `BlobPart[]`. */
  chunks: Uint8Array<ArrayBuffer>[]
  size: number
}

/**
 * The bytes of a store-only ZIP, as an ordered list of chunks.
 *
 * Writing to one contiguous `Uint8Array` needed a second copy of the whole
 * vault (a 40 MB export peaked at ~120 MB: notes + encoded entries + the
 * assembled bytes + the download's own copy). Handing the chunks to a `Blob`
 * lets the browser stream them to disk instead.
 */
function buildZip(entries: ZipEntry[], now: Date): ZipChunks {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)
  const locals: Uint8Array<ArrayBuffer>[] = []
  const centrals: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const data = encoder.encode(entry.content)
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const localView = new DataView(local.buffer as ArrayBuffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true) // version needed
    localView.setUint16(6, 0x0800, true) // UTF-8 flag
    localView.setUint16(8, 0, true) // stored
    localView.setUint16(10, time, true)
    localView.setUint16(12, date, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer as ArrayBuffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, time, true)
    centralView.setUint16(14, date, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const chunks = [...locals, ...centrals, end]
  return { chunks, size: offset + centralSize + end.length }
}

/** Minimal store-only ZIP. Valid for any unzip tool. */
export function zipStored(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { chunks, size } = buildZip(entries, now)
  const out = new Uint8Array(size)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}

/** Same bytes as `zipStored`, without the contiguous copy: what a download wants. */
export function zipStoredBlob(entries: ZipEntry[], now = new Date()): Blob {
  return new Blob(buildZip(entries, now).chunks, { type: 'application/zip' })
}

export function safeFileName(name: string, fallback = 'sin-titulo'): string {
  const clean = String(name)
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return clean || fallback
}

/** Markdown body of a note, with the title as the first H1 when it is missing. */
export function noteToMarkdown(note: Note): string {
  const body = note.markdown ?? ''
  const title = (note.title || '').trim()
  const firstHeading = body.match(/^#\s+(.+)$/m)
  if (!title || firstHeading) return body.endsWith('\n') ? body : `${body}\n`
  const withTitle = `# ${title}\n\n${body}`.replace(/\n{3,}/g, '\n\n')
  return withTitle.endsWith('\n') ? withTitle : `${withTitle}\n`
}

export interface ExportedFile {
  name: string
  content: string
}

/** One `.md` per note, inside a folder per folder, de-duplicating file names. */
/** Folder names may carry a nested path (`GUIONES/V3`); keep the segments. */
export function safePath(name: string, fallback = 'carpeta'): string {
  return String(name)
    .split('/')
    .map((segment) => safeFileName(segment, fallback))
    .filter(Boolean)
    .join('/')
}

export function notesToFiles(notes: Note[], folders: Folder[]): ExportedFile[] {
  const folderName = new Map(folders.map((f) => [f.id, safeFileName(f.name, 'carpeta')]))
  const used = new Set<string>()
  const files: ExportedFile[] = []

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
  return files
}

export function suggestExportName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  return `mdfire-${stamp}.zip`
}

/** Triggers a browser download. No-op outside a document (tests, SSR). */
export function download(data: Uint8Array | string | Blob, fileName: string, mime: string): void {
  if (typeof document === 'undefined') return
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data)], {
          type: mime,
        })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
