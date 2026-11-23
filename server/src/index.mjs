// Punto de entrada de Cloud Run: cablea el store real, la verificación de ID
// tokens y el MoR. Todo lo demás (core, http) es inyectable y testeable.
import http from 'node:http'
import { verifyFirebaseIdToken } from './auth.mjs'
import { createFirestoreStore } from './firestore.mjs'
import { createProxyHandler } from './http.mjs'
import { createPolar } from './providers/polar.mjs'

const port = Number(process.env.PORT ?? 8080)

/**
 * Polar es el MoR: cobra, factura y liquida. Lemon Squeezy ya no acepta altas
 * nuevas (cierra el 31-mar-2027), así que el adaptador es el de Polar.
 */
function buildCheckout() {
  const { POLAR_ACCESS_TOKEN, POLAR_PRODUCT_ID, POLAR_WEBHOOK_SECRET, POLAR_SERVER } = process.env
  if (!POLAR_ACCESS_TOKEN) return null
  return createPolar({
    accessToken: POLAR_ACCESS_TOKEN,
    productId: POLAR_PRODUCT_ID,
    webhookSecret: POLAR_WEBHOOK_SECRET,
    server: POLAR_SERVER === 'sandbox' ? 'sandbox' : 'production',
  })
}

let checkout = null
try {
  checkout = buildCheckout()
} catch (error) {
  console.warn(`checkout deshabilitado: ${error.message}`)
}

const store = await createFirestoreStore()
const handler = createProxyHandler({
  store,
  verifyIdToken: verifyFirebaseIdToken,
  checkout,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
})

const server = http.createServer(handler)
server.listen(port, () => {
  console.log(`firemd-proxy escuchando en :${port}${checkout ? '' : ' (sin checkout)'}`)
})

// Cloud Run manda SIGTERM al desplegar: dejar de aceptar y salir.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
