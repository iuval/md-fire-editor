/**
 * Nada de claves versionadas.
 *
 * GitHub abrió una alerta de secret scanning por la clave web de Firebase que
 * vivía como literal en `desktop/src/auth.rs`. Esa clave es pública por diseño
 * (viaja en el bundle y en `/__/firebase/init.json`), pero un literal en el
 * repo vuelve a disparar la alerta en cada clon y tapa las filtraciones que sí
 * importan. La regla es simple: las claves entran por el entorno, no por git.
 *
 * El escaneo es estructural: recorre los archivos versionados y busca el
 * prefijo de las claves de Google. No mira el historial (eso lo resuelve la
 * rotación, no un test).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_BYTES = 2 * 1024 * 1024

/** `AIza` + 35 caracteres: el formato de las claves de API de Google. */
const GOOGLE_API_KEY = /AIza[0-9A-Za-z_-]{35}/

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    env: { ...process.env, NODE_OPTIONS: '' },
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.toString('utf8').split('\0').filter(Boolean)
}

/** `null` para binarios y archivos enormes: no son candidatos a una clave. */
function textOf(file: string): string | null {
  const raw = readFileSync(resolve(ROOT, file))
  if (raw.byteLength > MAX_BYTES || raw.includes(0)) return null
  return raw.toString('utf8')
}

describe('secretos versionados', () => {
  it('ningún archivo versionado contiene una clave de API de Google', () => {
    const offenders = trackedFiles().flatMap((file) => {
      const text = textOf(file)
      return text !== null && GOOGLE_API_KEY.test(text) ? [file] : []
    })
    expect(offenders).toEqual([])
  })

  it('.env no se versiona', () => {
    const envFiles = trackedFiles().filter(
      (file) => file === '.env' || file.endsWith('/.env'),
    )
    expect(envFiles).toEqual([])
  })

  it('la clave del escritorio se inyecta al compilar, no se escribe', () => {
    const build = readFileSync(resolve(ROOT, 'desktop/build.rs'), 'utf8')
    const auth = readFileSync(resolve(ROOT, 'desktop/src/auth.rs'), 'utf8')
    expect(build).toContain('cargo:rustc-env=FIREMD_DEFAULT_API_KEY=')
    expect(auth).toMatch(
      /pub const DEFAULT_API_KEY: &str = env!\("FIREMD_DEFAULT_API_KEY"\)/,
    )
  })
})
