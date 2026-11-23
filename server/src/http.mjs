// Router del proxy: sin framework, sin dependencias, testeable con objetos
// request/response falsos o con el servidor HTTP real.
import { creditTopUp } from './billing.mjs'
import { CREDIT_PACKS, describeAccount, executeNoteOperation } from './core.mjs'

const MAX_BODY_BYTES = 1024 * 1024

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Op-Id',
  'Access-Control-Max-Age': '600',
}

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, 'payload-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => reject(new HttpError(400, 'body-read-failed')))
  })
}

function json(res, status, data, cors) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(cors ? CORS_HEADERS : {}),
  })
  res.end(body)
}

function parseJson(raw, code = 'invalid-json') {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new HttpError(400, code)
  }
}

/** Rechazos del core → respuesta HTTP con el estado que la UI necesita. */
function sendOperation(res, result, cors) {
  if (result.ok) {
    json(res, 200, result, cors)
    return
  }
  const status = result.status ?? 400
  json(res, status, result, cors)
}

export function createProxyHandler({
  store,
  verifyIdToken,
  checkout = null,
  now = () => new Date(),
  allowedOrigins = [],
  logger = console,
  quota,
} = {}) {
  if (!store) throw new Error('createProxyHandler: falta store')
  if (typeof verifyIdToken !== 'function') throw new Error('createProxyHandler: falta verifyIdToken')

  async function authenticate(req) {
    const header = req.headers.authorization ?? ''
    const match = /^Bearer (.+)$/.exec(header)
    if (!match) throw new HttpError(401, 'missing-token')
    const identity = await verifyIdToken(match[1])
    if (!identity?.uid) throw new HttpError(401, 'invalid-token')
    return identity
  }

  return async function handler(req, res) {
    const origin = req.headers.origin
    const cors = typeof origin === 'string' && allowedOrigins.includes(origin)
    if (cors) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')

    try {
      const url = new URL(req.url ?? '/', 'http://proxy.invalid')
      const rawPath = url.pathname.replace(/\/+$/, '') || '/'
      // Mismo origen vía Firebase Hosting: la rewrite `/api/**` conserva el
      // prefijo, así que el router lo descarta (`/api/v1/account` → `/v1/account`).
      const path = rawPath.startsWith('/api/') ? rawPath.slice(4) : rawPath

      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS)
        res.end()
        return
      }

      // `/healthz` exacto lo intercepta el frontend de Cloud Run (devuelve el
      // 404 HTML de Google y nunca llega al contenedor): la ruta viva es
      // `/health`. Se mantiene el alias para el smoke test local.
      if (path === '/health' || path === '/healthz') {
        json(res, 200, { ok: true }, cors)
        return
      }

      // El webhook viene del MoR, no de un usuario: se autentica con la firma.
      if (path === '/v1/billing/webhook') {
        if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed')
        if (!checkout) throw new HttpError(503, 'checkout-not-configured')
        const raw = await readBody(req)
        const event = await checkout.parseWebhook(raw, req.headers)
        if (event.ignored) {
          json(res, 200, { ok: true, ignored: true, event: event.eventName }, cors)
          return
        }
        const result = await creditTopUp(store, { ...event, now: now() })
        json(res, 200, result, cors)
        return
      }

      const identity = await authenticate(req)

      if (path === '/v1/account') {
        if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed')
        const account = await describeAccount(store, identity.uid, { now: now(), quota })
        json(res, 200, account, cors)
        return
      }

      const noteRoute = /^\/v1\/notes\/([^/]+)\/(blocks|body)$/.exec(path)
      if (noteRoute) {
        if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed')
        const noteId = decodeURIComponent(noteRoute[1])
        const kind = noteRoute[2] === 'blocks' ? 'block' : 'body'
        const raw = await readBody(req)
        const payload = parseJson(raw)
        const opId = payload.opId ?? req.headers['x-op-id']
        const opPayload = kind === 'block' ? payload.block : payload.body
        const result = await executeNoteOperation(store, {
          senderUid: identity.uid,
          noteId,
          kind,
          opId,
          payload: opPayload,
          now: now(),
          quota,
        })
        sendOperation(res, result, cors)
        return
      }

      if (path === '/v1/billing/checkout') {
        if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed')
        if (!checkout) throw new HttpError(503, 'checkout-not-configured')
        const raw = await readBody(req)
        const payload = parseJson(raw)
        const packUsd = Number(payload.packUsd)
        if (!CREDIT_PACKS.includes(packUsd)) {
          throw new HttpError(400, 'invalid-pack')
        }
        const session = await checkout.createSession({
          uid: identity.uid,
          packUsd,
          email: identity.email,
          successUrl: payload.successUrl,
          cancelUrl: payload.cancelUrl,
        })
        json(res, 200, { ...session, packUsd }, cors)
        return
      }

      throw new HttpError(404, 'not-found')
    } catch (err) {
      const status = Number(err?.status) || 500
      if (status >= 500) logger.error?.('proxy error', err)
      json(res, status, { error: err?.code ?? err?.message ?? 'internal-error' }, cors)
    }
  }
}
