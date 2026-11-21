// Agent identity: an anonymous Firebase account, paired from the web app.
//
// The agent is a normal Firebase user (provider "anonymous"), so every read and
// write goes through the same security rules as a person. The web app grants it
// a role on a folder (lectura / escritura) and can revoke it at any time by
// removing that member — no keys, no service account, no rule bypass.
//
// `mdfire login` prints a 12-character code; paste it in the app under
// "Agentes de IA".

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'mdfire')
const CREDENTIALS = join(CONFIG_DIR, 'credentials.json')

// The web API key is public (it ships in the bundle) and restricted by referrer,
// so requests carry the app origin. That is the only reason this header exists.
const DEFAULT_REFERER = 'https://md-sync-app.web.app/'

export function apiKey() {
  const key = process.env.MDFIRE_API_KEY
  if (!key) throw new Error('falta MDFIRE_API_KEY (o usá el .env del repo)')
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
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) headers.Referer = process.env.MDFIRE_REFERER || DEFAULT_REFERER
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

export async function readCredentials() {
  try {
    return JSON.parse(await readFile(CREDENTIALS, 'utf8'))
  } catch {
    return null
  }
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
    projectId: process.env.MDFIRE_PROJECT || 'md-sync-app',
    referer: process.env.MDFIRE_REFERER || DEFAULT_REFERER,
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
 * `MDFIRE_ID_TOKEN` short-circuits everything (used by tests and CI).
 */
export async function idToken({ force = false } = {}) {
  if (process.env.MDFIRE_ID_TOKEN) return process.env.MDFIRE_ID_TOKEN

  const creds = await readCredentials()
  if (!creds?.refreshToken) {
    throw new Error('no estás logueado: corré `mdfire login`')
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
  if (process.env.MDFIRE_ID_TOKEN) return { uid: '(token externo)', config: null }
  if (!creds?.uid) return null
  return { uid: creds.uid, config: CREDENTIALS }
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
  // The ID token is authoritative: an external MDFIRE_ID_TOKEN must not be
  // shadowed by whatever credentials happen to be on disk.
  const fromToken = uidFromToken(await idToken())
  if (fromToken) return fromToken
  return (await readCredentials())?.uid ?? null
}

/** Short, typo-friendly code shown to the user for pairing. */
export function pairingCode(uid) {
  return uid.slice(0, 12)
}
