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
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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

export async function signInWithGoogle(): Promise<User | null> {
  if (!auth) return null
  try {
    const cred = await signInWithPopup(auth, provider)
    return cred.user
  } catch (e) {
    console.error('Google sign-in error:', e)
    return null
  }
}

export async function signOutUser(): Promise<void> {
  if (!auth) return
  await signOut(auth)
}
