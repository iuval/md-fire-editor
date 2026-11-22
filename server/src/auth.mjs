// Verificación del ID token de Firebase. Dinámico para que el core no dependa
// del SDK: los tests inyectan un verificador falso.
let auth = null

async function adminAuth() {
  if (auth) return auth
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      ...(process.env.GOOGLE_CLOUD_PROJECT ? { projectId: process.env.GOOGLE_CLOUD_PROJECT } : {}),
    })
  }
  auth = getAuth()
  return auth
}

export async function verifyFirebaseIdToken(token) {
  const service = await adminAuth()
  try {
    const decoded = await service.verifyIdToken(token, true)
    return { uid: decoded.uid, email: decoded.email ?? null }
  } catch {
    return null
  }
}
