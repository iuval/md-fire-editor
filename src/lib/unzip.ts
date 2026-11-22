/**
 * Minimal ZIP reader, no dependencies.
 *
 * Obsidian vaults are ordinary ZIPs, so entries are usually DEFLATE-compressed.
 * Browsers ship `DecompressionStream('deflate-raw')` (Baseline), which is exactly
 * what a ZIP entry needs: raw DEFLATE, without the zlib header.
 */

export interface ZipFileEntry {
  path: string
  bytes: Uint8Array
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65_557) // max comment + EOCD
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i
  }
  return -1
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('este navegador no soporta descomprimir ZIP')
  }
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

export interface UnzipOptions {
  maxEntries?: number
  maxBytes?: number
}

export interface ZipEntryInfo {
  path: string
  /** Uncompressed size, from the central directory: no inflation needed. */
  size: number
}

interface CentralEntry extends ZipEntryInfo {
  method: number
  dataStart: number
  compressedSize: number
}

function* centralEntries(
  input: Uint8Array,
  { maxEntries = 2000, maxBytes = 80 * 1024 * 1024 }: UnzipOptions
): Generator<CentralEntry> {
  const bytes = new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  if (eocd === -1) throw new Error('el archivo no es un ZIP válido')

  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries > maxEntries) throw new Error(`el ZIP tiene demasiados archivos (${entries})`)

  let cursor = centralOffset

  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > view.byteLength) break
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break

    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue // directory
    if (uncompressedSize > maxBytes) continue
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue

    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    yield {
      path: name,
      size: uncompressedSize,
      method,
      compressedSize,
      dataStart: localOffset + 30 + localNameLength + localExtraLength,
    }
  }
}

/**
 * Names and sizes only — read straight from the central directory.
 *
 * A vault import needs every path up front (to strip the wrapper folder a ZIP
 * made by "Compress" carries) but no content, so this pass costs a few hundred
 * KB for a whole vault while `unzipEach` streams the bodies one at a time.
 */
export function zipEntryInfos(input: Uint8Array, options: UnzipOptions = {}): ZipEntryInfo[] {
  const out: ZipEntryInfo[] = []
  for (const entry of centralEntries(input, options)) out.push({ path: entry.path, size: entry.size })
  return out
}

/**
 * Entries one at a time.
 *
 * Importing a vault used to inflate every file up front, so a 40 MB vault held
 * the compressed bytes + every inflated entry + every decoded note at once
 * (~2-3× the vault). The caller now writes each note and lets the buffer go.
 */
export async function* unzipEach(
  input: Uint8Array,
  options: UnzipOptions = {}
): AsyncGenerator<ZipFileEntry> {
  const { maxBytes = 80 * 1024 * 1024 } = options
  const bytes = new Uint8Array(input)
  let total = 0

  for (const entry of centralEntries(input, options)) {
    const raw = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
    let content: Uint8Array
    if (entry.method === 0) {
      content = raw.slice()
    } else if (entry.method === 8) {
      content = await inflateRaw(raw)
    } else {
      continue // unsupported compression
    }

    total += content.byteLength
    if (total > maxBytes) throw new Error('el ZIP es demasiado grande')
    yield { path: entry.path, bytes: content }
  }
}

/** Collects every entry (tests, small files). Prefer `unzipEach` when importing. */
export async function unzip(input: Uint8Array, options: UnzipOptions = {}): Promise<ZipFileEntry[]> {
  const out: ZipFileEntry[] = []
  for await (const entry of unzipEach(input, options)) out.push(entry)
  return out
}

function decodeName(raw: Uint8Array): string {
  // Names written by macOS tools are UTF-8 but often lack the UTF-8 flag.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    for (const encoding of ['macintosh', 'windows-1252']) {
      try {
        return new TextDecoder(encoding, { fatal: true }).decode(raw)
      } catch {
        /* try the next one */
      }
    }
    return new TextDecoder().decode(raw)
  }
}
