// Identidad: la cuenta del usuario, o un agente anónimo aparte.
//
// `firemd login` abre el navegador y entra con la cuenta del sitio: desde ahí la
// CLI es la persona, con los mismos permisos y sin pegar ningún código. Esa
// sesión se registra en `agents/{id}` para poder nombrarla.
//
// `firemd login --agent` crea en cambio una cuenta anónima aparte, que sólo ve la
// carpeta que el dueño le comparta (el modelo anterior). Es opcional.
//
// Las credenciales quedan en `~/.config/firemd/credentials.json` (0600) y las
// comparte con la app de escritorio, así que un login sirve para las dos.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'firemd')
const CREDENTIALS = join(CONFIG_DIR, 'credentials.json')
// The app used to be called mdfire, so a session logged in before the rename
// lives one directory over. Reading it keeps that login working; the next save
// lands in the new path and the old file is simply left behind.
const LEGACY_CREDENTIALS = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'mdfire',
  'credentials.json'
)

// The web API key is public (it ships in the bundle) and restricted by referrer,
// so requests carry the app origin. That is the only reason this header exists.
const DEFAULT_REFERER = 'https://md-sync-app.web.app/'
const DEFAULT_SITE = 'https://firemd.app'
const LOGIN_TIMEOUT = 120_000

/** Orígenes que pueden devolver el handshake. El sitio, sus alias y el local. */
function handshakeOrigins() {
  return new Set([
    siteUrl(),
    'https://firemd.app',
    'https://www.firemd.app',
    'https://md-sync-app.web.app',
    'https://md-sync-app.firebaseapp.com',
  ])
}


export function apiKey() {
  const key = process.env.FIREMD_API_KEY
  if (!key) throw new Error('falta FIREMD_API_KEY (o usá el .env del repo)')
  return key
}

function authBase() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST
  return host ? `http://${host}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com'
}

function tokenBase() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST
  return host ? `http://${host}/securetoken.googleapis.com` : 'https://securetoken.googleapis.com'
}

function commonHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) headers.Referer = process.env.FIREMD_REFERER || DEFAULT_REFERER
  return headers
}

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: commonHeaders(), body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new Error(`auth: ${message}`)
  }
  return data
}

/** Dónde vive el sitio. `FIREMD_SITE` sirve para probar contra localhost. */
export function siteUrl() {
  return (process.env.FIREMD_SITE || DEFAULT_SITE).replace(/\/$/, '')
}

/** Abre el navegador del sistema. Devuelve false si no encontró cómo. */
export function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    // ENOENT llega como evento, no como excepción: sin este listener el proceso
    // se cae con un 'error' no manejado. Mejor imprimir la dirección.
    child.on('error', () => {
      process.stderr.write(`no pude abrir el navegador; abrí esta dirección:\n${url}\n`)
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * Espera el handshake del navegador en 127.0.0.1.
 *
 * La página del sitio (ya con la sesión de Google) hace POST a `/handshake` con
 * el refresh token. Un nonce de un solo uso evita que otra página se cuele.
 */
function waitForHandshake(server, nonce, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish()
      reject(new Error(`auth: no llegó la confirmación del navegador en ${Math.round(timeout / 1000)}s`))
    }, timeout)
    timer.unref?.()

    function finish() {
      clearTimeout(timer)
      server.close()
    }

    server.on('request', (request, response) => {
      const origin = request.headers.origin
      // El sitio de producción, sus alias de Firebase, y el que diga FIREMD_SITE
      // (para probar contra localhost sin tocar el código).
      const allowed = origin && handshakeOrigins().has(origin.replace(/\/$/, ''))
      const cors = allowed ? { 'Access-Control-Allow-Origin': origin } : {}

      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          ...cors,
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Private-Network': 'true',
        })
        response.end()
        return
      }

      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors })
        response.end(
          '<!doctype html><meta charset="utf-8"><title>FireMD</title>' +
            '<p style="font:16px system-ui;padding:2rem">Listo. Volvé a la terminal.</p>'
        )
        return
      }

      if (request.method !== 'POST' || request.url !== '/handshake') {
        response.writeHead(404, { 'Content-Type': 'application/json', ...cors })
        response.end('{"error":"not found"}')
        return
      }

      // Un origen que no es el sitio no puede consumir el handshake. Sin Origin
      // (curl, tests) se deja pasar: el nonce de la URL ya es el secreto.
      if (origin && !allowed) {
        response.writeHead(403, { 'Content-Type': 'application/json' })
        response.end('{"error":"origin"}')
        return
      }

      const chunks = []
      request.on('data', (chunk) => {
        chunks.push(chunk)
        if (Buffer.concat(chunks).length > 8192) request.destroy()
      })
      request.on('end', () => {
        let payload
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json', ...cors })
          response.end('{"error":"bad json"}')
          return
        }
        if (payload?.state !== nonce || !payload?.refreshToken) {
          response.writeHead(400, { 'Content-Type': 'application/json', ...cors })
          response.end('{"error":"state"}')
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json', ...cors })
        response.end('{"ok":true}')
        finish()
        resolve(payload)
      })
    })
  })
}

/**
 * Login con la cuenta del sitio: loopback + navegador.
 *
 * Google bloquea su OAuth dentro de webviews, así que se abre el navegador del
 * sistema en una página del sitio. Esa página ya tiene la sesión y devuelve el
 * refresh token al puerto local. El token se valida contra securetoken antes de
 * guardar nada.
 */
export async function loginWithBrowser({ site = siteUrl(), timeout = LOGIN_TIMEOUT } = {}) {
  const nonce = randomBytes(16).toString('hex')
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const port = server.address().port
  const url = `${site}/?desktop=${port}&state=${nonce}&client=cli`
  const opened = openBrowser(url)
  if (!opened) process.stderr.write(`abrí esta dirección en el navegador:\n${url}\n`)

  const handshake = await waitForHandshake(server, nonce, timeout)

  const session = await postJson(`${tokenBase()}/v1/token?key=${apiKey()}`, {
    grant_type: 'refresh_token',
    refresh_token: handshake.refreshToken,
  })

  const credentials = {
    uid: session.user_id,
    refreshToken: session.refresh_token || handshake.refreshToken,
    idToken: session.id_token,
    expiresAt: Date.now() + (Number(session.expires_in) || 3600) * 1000,
    projectId: process.env.FIREMD_PROJECT || 'md-sync-app',
    referer: process.env.FIREMD_REFERER || DEFAULT_REFERER,
    email: handshake.email || null,
    agentId: randomBytes(12).toString('hex'),
    agentName: null,
  }
  await writeCredentials(credentials)
  return credentials
}

export async function readCredentials() {
  for (const path of [CREDENTIALS, LEGACY_CREDENTIALS]) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      // Missing or unreadable: try the next location.
    }
  }
  return null
}

async function writeCredentials(data) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(CREDENTIALS, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  await chmod(CREDENTIALS, 0o600)
}

/** Create a fresh anonymous account. Returns the credentials to persist. */
export async function login() {
  const data = await postJson(`${authBase()}/v1/accounts:signUp?key=${apiKey()}`, {
    returnSecureToken: true,
  })

  const credentials = {
    uid: data.localId,
    refreshToken: data.refreshToken,
    idToken: data.idToken,
    expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000,
    projectId: process.env.FIREMD_PROJECT || 'md-sync-app',
    referer: process.env.FIREMD_REFERER || DEFAULT_REFERER,
  }
  await writeCredentials(credentials)
  return credentials
}

export async function logout() {
  const creds = await readCredentials()
  if (!creds) return
  try {
    await postJson(`${tokenBase()}/v1/token?key=${apiKey()}`, {
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    })
  } catch {
    // Revoking is best effort; deleting the file is what matters locally.
  }
  await writeCredentials({ ...creds, refreshToken: null, idToken: null, revoked: true })
}

/**
 * Returns a valid ID token, refreshing it when it is close to expiring.
 * `FIREMD_ID_TOKEN` short-circuits everything (used by tests and CI).
 */
export async function idToken({ force = false } = {}) {
  if (process.env.FIREMD_ID_TOKEN) return process.env.FIREMD_ID_TOKEN

  const creds = await readCredentials()
  if (!creds?.refreshToken) {
    throw new Error('no estás logueado: corré `firemd login`')
  }

  if (!force && creds.idToken && creds.expiresAt - 60_000 > Date.now()) return creds.idToken

  const data = await postJson(`${tokenBase()}/v1/token?key=${apiKey()}`, {
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  })

  const next = {
    ...creds,
    idToken: data.id_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  }
  await writeCredentials(next)
  return next.idToken
}

export async function whoami() {
  const creds = await readCredentials()
  if (process.env.FIREMD_ID_TOKEN) return { uid: '(token externo)', config: null }
  if (!creds?.uid) return null
  return {
    uid: creds.uid,
    email: creds.email ?? null,
    agentId: creds.agentId ?? null,
    agentName: creds.agentName ?? null,
    config: CREDENTIALS,
  }
}

/** Guarda id y nombre de esta sesión en las credenciales (`firemd name`). */
export async function saveAgentSession({ id, name } = {}) {
  const creds = await readCredentials()
  if (!creds) throw new Error('auth: no estás logueado')
  const next = {
    ...creds,
    agentId: id ?? creds.agentId ?? null,
    agentName: name ?? creds.agentName ?? null,
  }
  await writeCredentials(next)
  return next
}

/** Firebase uid encoded in an ID token (no network round-trip). */
export function uidFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return payload.user_id || payload.sub || null
  } catch {
    return null
  }
}

export async function currentUid() {
  // The ID token is authoritative: an external FIREMD_ID_TOKEN must not be
  // shadowed by whatever credentials happen to be on disk.
  const fromToken = uidFromToken(await idToken())
  if (fromToken) return fromToken
  return (await readCredentials())?.uid ?? null
}

/** Short, typo-friendly code shown to the user for pairing. */
export function pairingCode(uid) {
  return uid.slice(0, 12)
}
