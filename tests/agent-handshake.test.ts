/**
 * El servidor de loopback del `firemd login` de la CLI, contra procesos reales.
 *
 * No se puede abrir un navegador en un test, así que se le saca `open` del PATH:
 * el spawn falla con ENOENT y la CLI imprime la dirección con el puerto. Con esa
 * dirección se hacen los cuatro pedidos que un navegador haría (preflight, GET,
 * estado inválido, origen ajeno) y el handshake bueno. El login sigue hasta el
 * canje del token y falla ahí por falta de API key: eso prueba que el handshake
 * se resolvió y el servidor se cerró.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'http://127.0.0.1:9'

let child: ChildProcess | null = null

afterEach(() => {
  child?.kill()
  child = null
})

interface Login {
  port: number
  state: string
  /** Se resuelve cuando el login termina (con el error del canje de token). */
  finished: Promise<string>
}

/** Arranca el login sin navegador y espera a que imprima la dirección. */
function startLogin(): Promise<Login> {
  const script = `
    import { loginWithBrowser } from ${JSON.stringify(join(repo, 'agent/auth.mjs'))}
    loginWithBrowser({ site: ${JSON.stringify(SITE)}, timeout: 8000 })
      .then(() => console.log('LOGIN_OK'))
      .catch((e) => console.log('LOGIN_ERR ' + e.message))
  `
  const proc = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_OPTIONS: '', PATH: '/nonexistent', FIREMD_SITE: SITE, FIREMD_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child = proc

  const finished = new Promise<string>((resolve) => {
    proc.stdout!.on('data', (chunk) => {
      const text = String(chunk)
      if (text.includes('LOGIN_OK') || text.includes('LOGIN_ERR')) resolve(text.trim())
    })
  })

  return new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`sin dirección del login: ${stderr}`)), 9000)
    proc.stderr!.on('data', (chunk) => {
      stderr += String(chunk)
      const match = /http:\/\/127\.0\.0\.1:9\/\?desktop=(\d+)&state=([0-9a-f]+)/.exec(stderr)
      if (!match) return
      clearTimeout(timer)
      resolve({ port: Number(match[1]), state: match[2], finished })
    })
  })
}

describe('login por loopback de la CLI', () => {
  it('atiende preflight, página, estado inválido y origen ajeno', async () => {
    const { port, state, finished } = await startLogin()

    const preflight = await fetch(`http://127.0.0.1:${port}/handshake`, {
      method: 'OPTIONS',
      headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(SITE)

    const page = await fetch(`http://127.0.0.1:${port}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Volvé a la terminal')

    const badState = await fetch(`http://127.0.0.1:${port}/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ state: 'deadbeef', refreshToken: 'x' }),
    })
    expect(badState.status).toBe(400)

    const evilOrigin = await fetch(`http://127.0.0.1:${port}/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ state, refreshToken: 'x' }),
    })
    expect(evilOrigin.status).toBe(403)
    expect(evilOrigin.headers.get('access-control-allow-origin')).toBeNull()

    const good = await fetch(`http://127.0.0.1:${port}/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SITE },
      body: JSON.stringify({ state, refreshToken: 'fake', email: 'ana@ejemplo.com' }),
    })
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ ok: true })

    // El handshake resolvió: el login siguió al canje de token y falló ahí.
    expect(await finished).toContain('falta FIREMD_API_KEY')
  }, 20_000)

  it('corta cuando el handshake no llega', async () => {
    const script = `
      import { loginWithBrowser } from ${JSON.stringify(join(repo, 'agent/auth.mjs'))}
      loginWithBrowser({ site: ${JSON.stringify(SITE)}, timeout: 300 })
        .then(() => console.log('LOGIN_OK'))
        .catch((e) => console.log('LOGIN_ERR ' + e.message))
    `
    const proc = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_OPTIONS: '', PATH: '/nonexistent', FIREMD_SITE: SITE, FIREMD_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = proc

    const out = await new Promise<string>((resolve) => {
      let buffer = ''
      proc.stdout!.on('data', (chunk) => {
        buffer += String(chunk)
        if (buffer.includes('LOGIN_OK') || buffer.includes('LOGIN_ERR')) resolve(buffer)
      })
    })
    expect(out).toContain('no llegó la confirmación del navegador')
  }, 20_000)
})
