import { initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
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
import { t } from './i18n/index.ts'

let app: FirebaseApp | null = null
let authInstance: ReturnType<typeof getAuth> | null = null
let dbInstance: ReturnType<typeof initializeFirestore> | null = null

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig)

    // App Check is enabled automatically when a reCAPTCHA Enterprise site key is
    // provided at build time. The provider is the Enterprise one because its
    // keys can be created and scoped per domain through the API, which is how
    // the key for firemd.app was provisioned; a v3 key has to be clicked
    // together in a console.
    //
    // Enforcement is deliberately still off in the console: the CLI and the
    // desktop app call Identity Toolkit and Firestore over REST with no App
    // Check token (`grep -r AppCheck agent desktop` finds nothing), so flipping
    // it would cut `firemd login` and every `mdfire` command. In monitor mode
    // the SDK only mints tokens, and the console shows how much traffic we
    // would already be rejecting.
    const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined
    if (appCheckKey) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(appCheckKey),
          isTokenAutoRefreshEnabled: true,
        })
      } catch (e) {
        // A bad or revoked key must not take the app down: App Check is
        // observability right now, not a gate.
        console.warn('App Check init failed (ignored while unenforced):', e)
      }
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
        t('signIn.blockedReferer'),
    }
  }
  if (code === 'auth/popup-blocked') {
    return { failure: 'popup-blocked', message: t('signIn.popupBlocked') }
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return { failure: 'cancelled', message: t('signIn.cancelled') }
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return { failure: 'unsupported', message: t('signIn.unsupported') }
  }
  return { failure: 'unknown', message }
}

export async function signInWithGoogle(): Promise<SignInResult> {
  if (!auth) return { user: null, failure: 'unknown', message: t('error.firebaseNotConfigured') }
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
