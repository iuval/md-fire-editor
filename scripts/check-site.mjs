// Production probe for the public domains: reachability, TLS validity, and the
// security headers that only exist if the Hosting config actually deployed.
//
// Used by `.github/workflows/uptime.yml` on a schedule. Fails loudly (exit 1)
// so the scheduled run turns red and GitHub notifies the repo owner — that is
// the alerting channel, there is no third-party monitor.
import { request } from 'node:https'
import { connect } from 'node:tls'

const HOSTS = (process.env.CHECK_HOSTS ?? 'firemd.app,www.firemd.app').split(',')
const MIN_CERT_DAYS = Number(process.env.MIN_CERT_DAYS ?? 21)
const CANONICAL_HOST = process.env.CANONICAL_HOST ?? 'firemd.app'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000)

let pass = 0
let fail = 0

function check(ok, label, detail = '') {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Reads the certificate the edge actually serves for `host`. */
function peekCertificate(host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host }, () => {
      const cert = socket.getPeerCertificate()
      const authorized = socket.authorized
      const authorizationError = socket.authorizationError
      socket.end()
      if (!cert || !cert.valid_to) {
        reject(new Error(`${host}: no certificate presented`))
        return
      }
      resolve({ cert, authorized, authorizationError })
    })
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new Error(`${host}: TLS handshake timed out`))
    })
    socket.on('error', reject)
  })
}

/** Fetches `/` and returns status, headers, and body. Follows the edge's 301. */
function getRoot(host) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host, path: '/', method: 'GET', headers: { 'user-agent': 'firemd-uptime' } },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
      }
    )
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`${host}: request timed out`)))
    req.on('error', reject)
    req.end()
  })
}

async function probeHost(host) {
  const { cert, authorized, authorizationError } = await peekCertificate(host)
  const days = (Date.parse(cert.valid_to) - Date.now()) / 86_400_000
  const sans = (cert.subjectaltname ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/, ''))

  check(authorized, `${host} chain valid`, String(authorizationError ?? 'ok'))
  check(sans.includes(host), `${host} cert covers host`, `SAN ${sans.join(' ')}`)
  check(
    days >= MIN_CERT_DAYS,
    `${host} cert has ≥${MIN_CERT_DAYS} days`,
    `${days.toFixed(1)} days (expires ${cert.valid_to})`
  )

  const res = await getRoot(host)
  check(res.status === 200, `${host} GET / == 200`, String(res.status))
  check(res.body.includes('FireMD'), `${host} serves the app`, `${res.body.length} bytes`)
  check(
    Boolean(res.headers['strict-transport-security']),
    `${host} HSTS header`,
    res.headers['strict-transport-security'] ?? 'missing'
  )
  check(
    Boolean(res.headers['content-security-policy']),
    `${host} CSP header`,
    (res.headers['content-security-policy'] ?? 'missing').slice(0, 60)
  )
  check(res.headers['x-frame-options'] === 'DENY', `${host} X-Frame-Options DENY`)
  check(
    res.body.includes(`rel="canonical" href="https://${CANONICAL_HOST}/"`),
    `${host} canonical points at ${CANONICAL_HOST}`
  )
  check(
    res.headers['content-type']?.startsWith('text/html'),
    `${host} content-type html`,
    res.headers['content-type'] ?? 'missing'
  )
}

for (const host of HOSTS) {
  try {
    await probeHost(host)
  } catch (error) {
    check(false, `${host} reachable`, error.message)
  }
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail === 0 ? 0 : 1)
