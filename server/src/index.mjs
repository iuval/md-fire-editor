// Punto de entrada de Cloud Run: cablea el store real, la verificación de ID
// tokens y el MoR. Todo lo demás (core, http) es inyectable y testeable.
import http from 'node:http'
import { verifyFirebaseIdToken } from './auth.mjs'
import { createFirestoreStore } from './firestore.mjs'
import { createProxyHandler } from './http.mjs'
import { createLemonSqueezy } from './providers/lemonsqueezy.mjs'

const port = Number(process.env.PORT ?? 8080)

function buildCheckout() {
  const {
    LEMONSQUEEZY_API_KEY,
    LEMONSQUEEZY_STORE_ID,
    LEMONSQUEEZY_VARIANT_ID,
    LEMONSQUEEZY_WEBHOOK_SECRET,
    LEMONSQUEEZY_API_BASE,
  } = process.env
  if (!LEMONSQUEEZY_API_KEY) return null
  return createLemonSqueezy({
    apiKey: LEMONSQUEEZY_API_KEY,
    storeId: LEMONSQUEEZY_STORE_ID,
    variantId: LEMONSQUEEZY_VARIANT_ID,
    webhookSecret: LEMONSQUEEZY_WEBHOOK_SECRET,
    ...(LEMONSQUEEZY_API_BASE ? { apiBase: LEMONSQUEEZY_API_BASE } : {}),
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
