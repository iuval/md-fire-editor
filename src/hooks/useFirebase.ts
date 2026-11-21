import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, isFirebaseReady, signInWithGoogle, signOutUser } from '../firebase'
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  migrateLegacyNotes,
  MIGRATION_FLAG,
  subscribeMyFolders,
  subscribeMyNotes,
  type Folder,
  type Note,
} from '../lib/notes'
import { publishOwnDirectoryEntry } from '../lib/directory'

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

  // Publish (or refresh) this user's directory entry so others can add them by
  // email. Best-effort: failure never blocks the session.
  useEffect(() => {
    if (!user) return
    void publishOwnDirectoryEntry(user.uid, user.email, user.displayName).catch(() => undefined)
  }, [user])

  const doGoogleSignIn = useCallback(async () => {
    const result = await signInWithGoogle()
    setError(result.user ? null : (result.message ?? 'No se pudo iniciar sesión con Google'))
    return result.user
  }, [])

  const doSignOut = useCallback(async () => {
    await signOutUser()
  }, [])

  return { user, loading, error, doGoogleSignIn, doSignOut }
}

export function useWorkspace(uid: string | undefined) {
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !isFirebaseReady()) {
      setNotes([])
      setFolders([])
      setLoading(false)
      return
    }

    setLoading(true)
    let notesReady = false
    let foldersReady = false
    const settle = () => {
      if (notesReady && foldersReady) setLoading(false)
    }

    const unsubNotes = subscribeMyNotes(
      uid,
      (next) => {
        notesReady = true
        setNotes(next)
        setError(null)
        settle()
      },
      (message) => {
        setError(message)
        setLoading(false)
      }
    )

    const unsubFolders = subscribeMyFolders(
      uid,
      (next) => {
        foldersReady = true
        setFolders(next)
        settle()
      },
      (message) => {
        setError(message)
        setLoading(false)
      }
    )

    return () => {
      unsubNotes()
      unsubFolders()
    }
  }, [uid])

  // v1 → v2 migration, once per browser.
  useEffect(() => {
    if (!uid || !isFirebaseReady()) return
    if (localStorage.getItem(MIGRATION_FLAG)) return
    localStorage.setItem(MIGRATION_FLAG, '1')
    void migrateLegacyNotes(uid).catch(() => localStorage.removeItem(MIGRATION_FLAG))
  }, [uid])

  const addNote = useCallback(
    async (folder?: Folder) => {
      if (!uid) return null
      return createNote(uid, folder)
    },
    [uid]
  )

  const addFolder = useCallback(
    async (
      name: string,
      parentId: string | null = null,
      options: { sort?: import('../lib/sorting').SortMode; order?: number } = {}
    ) => {
      if (!uid) return null
      return createFolder(uid, name, parentId, [], options)
    },
    [uid]
  )

  const removeNote = useCallback(async (noteId: string) => {
    await deleteNote(noteId)
  }, [])

  const removeFolder = useCallback(async (folderId: string) => {
    await deleteFolder(folderId)
  }, [])

  return { notes, folders, loading, error, addNote, addFolder, removeNote, removeFolder }
}
