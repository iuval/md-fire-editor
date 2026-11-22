import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, isFirebaseReady, signInWithGoogle, signOutUser } from '../firebase'
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  migrateLegacyNotes,
  migrateNoteBodies,
  MIGRATION_FLAG,
  reserveFolderId,
  subscribeMyFolders,
  subscribeMyNotes,
  type Folder,
  type Note,
  type NoteKind,
} from '../lib/notes'
import { publishOwnDirectoryEntry } from '../lib/directory'
import { subscribeMyAgents, type Agent } from '../lib/agents'

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
  // email. It is two writes nobody on this screen reads, so it waits until the
  // session has settled instead of competing with the first paint and the
  // notes/folders listeners.
  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      void publishOwnDirectoryEntry(user.uid, user.email, user.displayName).catch(() => undefined)
    }, 6000)
    return () => clearTimeout(timer)
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
  /**
   * Folders created before their document lands. Creating one used to cost two
   * round trips (write + snapshot) with nothing on screen in between; the row
   * now appears on the first frame under an id reserved on the client.
   */
  const [pendingFolders, setPendingFolders] = useState<Folder[]>([])
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
        // The real copy arrived: stop showing the optimistic one.
        setPendingFolders((prev) => {
          const settled = prev.filter((pending) => !next.some((folder) => folder.id === pending.id))
          return settled.length === prev.length ? prev : settled
        })
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

  /**
   * Bodies still inline in the note document get their own document, once.
   *
   * Runs whenever the snapshot shows a note in the old shape and stays quiet
   * afterwards; each note is attempted at most once per session so a rejected
   * write cannot turn into a loop.
   */
  const attemptedBodies = useRef(new Map<string, number>())
  useEffect(() => {
    if (!uid) return
    // Twice per note is enough: a permission error (rules newer than the deploy)
    // is not worth a retry storm, but a transient one does get another chance.
    const legacy = notes.filter(
      (note) =>
        (note.markdown ?? '') !== '' &&
        note.markdownBytes === undefined &&
        (attemptedBodies.current.get(note.id) ?? 0) < 2
    )
    if (legacy.length === 0) return
    legacy.forEach((note) => attemptedBodies.current.set(note.id, (attemptedBodies.current.get(note.id) ?? 0) + 1))
    void migrateNoteBodies(legacy)
      .then(({ migrated }) => {
        // Only the ones that made it are done; the rest stay retryable.
        migrated.forEach((id) => attemptedBodies.current.set(id, Number.POSITIVE_INFINITY))
      })
      .catch(() => undefined)
  }, [notes, uid])

  // v1 → v2 migration, once per browser.
  useEffect(() => {
    if (!uid || !isFirebaseReady()) return
    if (localStorage.getItem(MIGRATION_FLAG)) return
    localStorage.setItem(MIGRATION_FLAG, '1')
    void migrateLegacyNotes(uid).catch(() => localStorage.removeItem(MIGRATION_FLAG))
  }, [uid])

  const addNote = useCallback(
    async (folder?: Folder, id?: string, kind: NoteKind = 'note') => {
      if (!uid) return null
      return createNote(uid, folder, id, kind)
    },
    [uid]
  )

  const addFolder = useCallback(
    async (
      name: string,
      parentId: string | null = null,
      options: { sort?: import('../lib/sorting').SortMode; order?: number } = {},
      id?: string
    ) => {
      if (!uid) return null
      return createFolder(uid, name, parentId, [], options, id)
    },
    [uid]
  )

  /** Shows a folder whose document is still being written. */
  const addOptimisticFolder = useCallback((folder: Folder) => {
    setPendingFolders((prev) => (prev.some((item) => item.id === folder.id) ? prev : [...prev, folder]))
  }, [])

  /** Takes it back when the write failed. */
  const dropOptimisticFolder = useCallback((folderId: string) => {
    setPendingFolders((prev) => prev.filter((folder) => folder.id !== folderId))
  }, [])

  const removeNote = useCallback(async (noteId: string) => {
    await deleteNote(noteId)
  }, [])

  const removeFolder = useCallback(async (folderId: string) => {
    await deleteFolder(folderId)
  }, [])

  /** Optimistic folders that the snapshot has not confirmed yet. */
  const visibleFolders = useMemo(() => {
    if (pendingFolders.length === 0) return folders
    const known = new Set(folders.map((folder) => folder.id))
    const pending = pendingFolders.filter((folder) => !known.has(folder.id))
    return pending.length === 0 ? folders : [...folders, ...pending]
  }, [folders, pendingFolders])

  return {
    notes,
    folders: visibleFolders,
    loading,
    error,
    addNote,
    addFolder,
    addOptimisticFolder,
    dropOptimisticFolder,
    reserveFolderId,
    removeNote,
    removeFolder,
  }
}

/**
 * Los agentes conectados a esta cuenta. Se registran solos al loguearse con la
 * CLI o con la app de escritorio; acá sólo se miran y se renombran.
 */
export function useAgents(uid: string | undefined) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !isFirebaseReady()) {
      setAgents([])
      return
    }
    return subscribeMyAgents(
      uid,
      (next) => {
        setAgents(next)
        setError(null)
      },
      (message) => setError(message)
    )
  }, [uid])

  return { agents, error }
}
