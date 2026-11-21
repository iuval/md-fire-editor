import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, isFirebaseReady, signInWithGoogle, signOutUser } from '../firebase'
import {
  createNote,
  deleteNote,
  migrateLegacyNotes,
  subscribeMyNotes,
  type Note,
} from '../lib/notes'

const MIGRATION_FLAG = 'mdfire-migrated-v2'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      setError('Firebase no está configurado')
      return
    }
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u)
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      }
    )
    return unsub
  }, [])

  const doGoogleSignIn = useCallback(async () => {
    const u = await signInWithGoogle()
    if (!u) setError('No se pudo iniciar sesión con Google')
    else setError(null)
    return u
  }, [])

  const doSignOut = useCallback(async () => {
    await signOutUser()
  }, [])

  return { user, loading, error, doGoogleSignIn, doSignOut }
}

export function useMyNotes(uid: string | undefined) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !isFirebaseReady()) {
      setNotes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeMyNotes(
      uid,
      (next) => {
        setNotes(next)
        setLoading(false)
        setError(null)
      },
      (message) => {
        setError(message)
        setLoading(false)
      }
    )
    return unsub
  }, [uid])

  // v1 → v2 migration, once per browser.
  useEffect(() => {
    if (!uid || !isFirebaseReady()) return
    if (localStorage.getItem(MIGRATION_FLAG)) return
    localStorage.setItem(MIGRATION_FLAG, '1')
    void migrateLegacyNotes(uid).catch(() => localStorage.removeItem(MIGRATION_FLAG))
  }, [uid])

  const addNote = useCallback(async () => {
    if (!uid) return null
    return createNote(uid)
  }, [uid])

  const removeNote = useCallback(async (noteId: string) => {
    await deleteNote(noteId)
  }, [])

  return { notes, loading, error, addNote, removeNote }
}
