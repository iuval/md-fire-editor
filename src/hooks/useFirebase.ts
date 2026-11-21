import { useState, useEffect, useCallback } from 'react'
import {
  auth,
  db,
  signInWithGoogle,
  signOutUser,
  type Note,
  saveNote,
  deleteNote,
  isFirebaseReady,
  type NoteTimestamp,
} from '../firebase'
import { onSnapshot, collection, query, orderBy, doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged, type User } from 'firebase/auth'

const LOCAL_USER_ID = 'local-user'
const NOTES_KEY = 'mdfire-notes'

function loadLocalNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Note[]
    return arr.sort((a, b) => {
      const ta = (a.updatedAt as NoteTimestamp)?.seconds ?? 0
      const tb = (b.updatedAt as NoteTimestamp)?.seconds ?? 0
      return tb - ta
    })
  } catch {
    return []
  }
}

function saveLocalNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    if (!auth) {
      if (mounted) setLoading(false)
      return
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      if (mounted) {
        setUser(u)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      unsub()
    }
  }, [])

  const doGoogleSignIn = useCallback(async () => {
    return await signInWithGoogle()
  }, [])

  const doSignOut = useCallback(async () => {
    await signOutUser()
  }, [])

  return { user, loading, doGoogleSignIn, doSignOut }
}

export function useNotes(userId: string | undefined) {
  const isLocal = !isFirebaseReady() || userId === LOCAL_USER_ID
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setNotes([])
      setLoading(false)
      return
    }

    if (isLocal) {
      setNotes(loadLocalNotes())
      setLoading(false)
      return
    }

    if (!db) return

    setLoading(true)
    const q = query(collection(db, 'users', userId, 'notes'), orderBy('updatedAt', 'desc'))

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Note))
        setNotes(items)
        setLoading(false)
      },
      (err) => {
        console.error('Firestore sync error:', err)
        setError(err.message)
        setLoading(false)
      }
    )

    return () => unsub()
  }, [userId, isLocal])

  const createNote = useCallback(async () => {
    const id = crypto.randomUUID()
    const now: NoteTimestamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
    const note: Note = {
      id,
      title: 'Untitled Note',
      content: '',
      createdAt: now,
      updatedAt: now,
    }

    if (isLocal) {
      const current = loadLocalNotes()
      const next = [note, ...current]
      saveLocalNotes(next)
      setNotes(next)
      return note
    }

    if (!userId) return null
    try {
      await saveNote(userId, note)
    } catch {
      // offline fallback
    }
    return note
  }, [userId, isLocal])

  const updateNote = useCallback(
    async (note: Note) => {
      const now: NoteTimestamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
      const updated: Note = { ...note, updatedAt: now }

      if (isLocal) {
        const current = loadLocalNotes()
        const next = current.map((n) => (n.id === updated.id ? updated : n))
        saveLocalNotes(next)
        setNotes(next)
        return
      }

      if (!userId) return
      try {
        await saveNote(userId, updated)
      } catch {
        // offline
      }
    },
    [userId, isLocal]
  )

  const removeNote = useCallback(
    async (noteId: string) => {
      if (isLocal) {
        const current = loadLocalNotes()
        const next = current.filter((n) => n.id !== noteId)
        saveLocalNotes(next)
        setNotes(next)
        return
      }

      if (!userId) return
      try {
        await deleteNote(userId, noteId)
      } catch {
        // offline
      }
    },
    [userId, isLocal]
  )

  const getNote = useCallback(
    async (noteId: string): Promise<Note | null> => {
      if (isLocal) {
        return loadLocalNotes().find((n) => n.id === noteId) || null
      }
      if (!userId || !db) return null
      const ref = doc(db, 'users', userId, 'notes', noteId)
      const snap = await getDoc(ref)
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() } as Note
    },
    [userId, isLocal]
  )

  return { notes, loading, error, createNote, updateNote, removeNote, getNote }
}
