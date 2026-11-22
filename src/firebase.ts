import { initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import firebaseConfig from './firebaseConfig'

let app: FirebaseApp | null = null
let authInstance: ReturnType<typeof getAuth> | null = null
let dbInstance: ReturnType<typeof initializeFirestore> | null = null

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig)

    // App Check is enabled automatically when a reCAPTCHA v3 site key is
    // provided at build time. Once it is enforced in the Firebase console,
    // requests without a valid token are rejected.
    const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined
    if (appCheckKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckKey),
        isTokenAutoRefreshEnabled: true,
      })
    }

    authInstance = getAuth(app)
    void setPersistence(authInstance, browserLocalPersistence)

    dbInstance = initializeFirestore(app, {
      // The SDK's default LRU threshold is 40 MB of serialised documents, and an
      // open note keeps its body in there twice (the sidebar query and the note
      // document). 20 MB is well above what a session reads and bounds the cache
      // on machines with less memory than the one it was tuned on.
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: 20 * 1024 * 1024,
      }),
      ignoreUndefinedProperties: true,
    })
  }
} catch (e) {
  console.warn('Firebase init failed:', e)
}

export const auth = authInstance
export const db = dbInstance

export function isFirebaseReady(): boolean {
  return !!app && !!auth && !!db
}

export interface AuthUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

export type SignInFailure =
  | 'blocked-referer'
  | 'popup-blocked'
  | 'cancelled'
  | 'unsupported'
  | 'unknown'

export interface SignInResult {
  user: User | null
  failure: SignInFailure | null
  message: string | null
}

function classifySignInError(error: unknown): { failure: SignInFailure; message: string } {
  const code = (error as { code?: string })?.code ?? ''
  const message = (error as Error)?.message ?? String(error)

  if (code.includes('requests-from-referer') || message.includes('requests-from-referer')) {
    return {
      failure: 'blocked-referer',
      message:
        'Este origen no está autorizado en la API key de Firebase. Agregá este puerto a los referrers de la key (ver README).',
    }
  }
  if (code === 'auth/popup-blocked') {
    return { failure: 'popup-blocked', message: 'El navegador bloqueó la ventana de Google. Permití popups para este sitio.' }
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return { failure: 'cancelled', message: 'Se cerró la ventana de Google antes de terminar.' }
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return { failure: 'unsupported', message: 'Este navegador no permite el login con Google.' }
  }
  return { failure: 'unknown', message }
}

export async function signInWithGoogle(): Promise<SignInResult> {
  if (!auth) return { user: null, failure: 'unknown', message: 'Firebase no está configurado' }
  try {
    const cred = await signInWithPopup(auth, provider)
    return { user: cred.user, failure: null, message: null }
  } catch (e) {
    console.error('Google sign-in error:', e)
    const { failure, message } = classifySignInError(e)
    return { user: null, failure, message }
  }
}

export async function signOutUser(): Promise<void> {
  if (!auth) return
  await signOut(auth)
}
