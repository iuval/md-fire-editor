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

export async function unzip(
  input: Uint8Array,
  { maxEntries = 2000, maxBytes = 80 * 1024 * 1024 }: UnzipOptions = {}
): Promise<ZipFileEntry[]> {
  const bytes = new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  if (eocd === -1) throw new Error('el archivo no es un ZIP válido')

  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entries > maxEntries) throw new Error(`el ZIP tiene demasiados archivos (${entries})`)

  const decoder = new TextDecoder()
  const out: ZipFileEntry[] = []
  let total = 0
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
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue // directory
    if (uncompressedSize > maxBytes) continue

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    let content: Uint8Array
    if (method === 0) {
      content = raw.slice()
    } else if (method === 8) {
      content = await inflateRaw(raw)
    } else {
      continue // unsupported compression
    }

    total += content.byteLength
    if (total > maxBytes) throw new Error('el ZIP es demasiado grande')
    out.push({ path: name, bytes: content })
  }

  return out
}
