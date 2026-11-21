import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import firebaseConfig from './firebaseConfig'

let app: FirebaseApp | null = null
let authInstance: ReturnType<typeof getAuth> | null = null
let dbInstance: ReturnType<typeof getFirestore> | null = null

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig)
    authInstance = getAuth(app)
    dbInstance = getFirestore(app)
  }
} catch (e) {
  console.warn('Firebase init failed:', e)
}

export const auth = authInstance
export const db = dbInstance

export interface NoteTimestamp {
  seconds: number
  nanoseconds: number
}

export interface Note {
  id: string
  title: string
  content: string
  updatedAt?: NoteTimestamp | Timestamp
  createdAt?: NoteTimestamp | Timestamp
}

export function isFirebaseReady(): boolean {
  return !!app && !!auth && !!db
}

export async function signInWithGoogle(): Promise<User | null> {
  if (!auth) return null
  const provider = new GoogleAuthProvider()
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

export async function ensureAuth(): Promise<User | null> {
  if (!auth) return null
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub()
      if (user) {
        resolve(user)
      } else {
        try {
          const cred = await signInAnonymously(auth)
          resolve(cred.user)
        } catch {
          resolve(null)
        }
      }
    })
  })
}

export async function saveNote(userId: string, note: Note): Promise<void> {
  if (!db) throw new Error('Firebase not ready')
  const ref = doc(db, 'users', userId, 'notes', note.id)
  await setDoc(
    ref,
    {
      title: note.title,
      content: note.content,
      updatedAt: serverTimestamp(),
      createdAt: note.createdAt || serverTimestamp(),
    },
    { merge: true }
  )
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  if (!db) throw new Error('Firebase not ready')
  await deleteDoc(doc(db, 'users', userId, 'notes', noteId))
}

export async function loadNotes(userId: string): Promise<Note[]> {
  if (!db) return []
  const q = query(collection(db, 'users', userId, 'notes'), orderBy('updatedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Note))
}

export { serverTimestamp }
