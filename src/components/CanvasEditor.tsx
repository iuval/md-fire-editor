import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { acquireNoteSession } from '../lib/collab/noteSession'
import type { AwarenessUser, CollabUser } from '../lib/collab/awareness'
import type { ProviderStatus, SyncStats } from '../lib/collab/provider'
import { colorForUid } from '../lib/collab/presenceColors'
import { MAX_CANVAS_CHARS, parseCanvas, serializeCanvas } from '../lib/canvas/model'
import type { Note } from '../lib/notes'
import type { CanvasFileRef } from '../lib/canvas/files'
import { CanvasSurface } from './CanvasSurface'

/**
 * The collaborative side of a canvas note: one shared Y.Doc per note (same
 * session as the markdown editor), the JSON⇄Y.Doc binding, and the debounced
 * write back to `notes/{id}/body/main`.
 *
 * The body stays the source of truth for everyone who is not in this tab (the
 * agent CLI, a vault import, another device), exactly like markdown notes. The
 * document is seeded once, and later external writes are merged by card id.
 */
export interface CanvasEditorProps {
  note: Note
  /** The `.canvas` text currently stored in the note body. */
  body: string
  uid: string
  userName: string
  editable: boolean
  isMobile: boolean
  files: CanvasFileRef[]
  onOpenNote: (noteId: string) => void
  onJsonChange: (json: string) => void
  onPresence: (users: AwarenessUser[]) => void
  onStatus: (status: ProviderStatus) => void
  onStats?: (stats: SyncStats) => void
}

/** Trailing debounce: a drag is one write, not one per frame. */
const EMIT_IDLE_MS = 400

export function CanvasEditor({
  note,
  body,
  uid,
  userName,
  editable,
  isMobile,
  files,
  onOpenNote,
  onJsonChange,
  onPresence,
  onStatus,
  onStats,
}: CanvasEditorProps) {
  const userInfo: CollabUser = useMemo(
    () => ({ name: userName, color: colorForUid(uid) }),
    [userName, uid]
  )

  const [tooLarge, setTooLarge] = useState(false)
  const owner = useId()
  const [session] = useState(() => acquireNoteSession(note.id, uid, userInfo, owner))
  useEffect(() => () => session.release(owner), [session, owner])

  // The binding belongs to the shared document (see `noteSession`), so a second
  // pane — or StrictMode's double mount — reuses it instead of building a
  // second one over the same Y.Doc.
  const ycanvas = session.canvas

  // Seeded during the first render, so the canvas paints with its cards instead
  // of flashing an empty grid and then fitting to nothing. Only the first view
  // seeds; a second pane renders what the document already holds.
  useState(() => {
    if (session.claimSeed(owner) && body.trim()) ycanvas.seedFromText(body)
    return true
  })
  const lastRef = useRef(serializeCanvas(ycanvas.toJSON()))

  const changeRef = useRef(onJsonChange)
  useEffect(() => {
    changeRef.current = onJsonChange
  }, [onJsonChange])

  // Local changes → the note body, once per burst of interaction.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = ycanvas.subscribe(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const json = serializeCanvas(ycanvas.toJSON())
        if (json === lastRef.current) return
        // Firestore's limit is bytes, not characters: Spanish accents and emoji
        // make a 600.000-character canvas slightly bigger than 600.000 bytes.
        if (new TextEncoder().encode(json).length > MAX_CANVAS_CHARS) {
          // The body document slices at its limit, and a sliced canvas is an
          // unparseable file: refuse the write and say so instead.
          setTooLarge(true)
          return
        }
        setTooLarge(false)
        lastRef.current = json
        changeRef.current(json)
      }, EMIT_IDLE_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ycanvas])

  // External writes (agent CLI, vault import, another device): one view applies
  // them, the rest render what the shared document already holds.
  useEffect(() => {
    if (!session.isPrimary(owner)) return
    const incoming = body ?? ''
    if (!incoming.trim()) return
    if (incoming === lastRef.current) return
    let parsed
    try {
      parsed = parseCanvas(incoming).canvas
    } catch {
      return
    }
    const canonical = serializeCanvas(parsed)
    if (canonical === lastRef.current) return
    lastRef.current = canonical
    ycanvas.applyExternal(parsed)
  }, [body, session, owner, ycanvas])

  useEffect(() => {
    const offStatus = session.provider.onStatus(onStatus)
    const offUsers = session.awareness.onUserChange(onPresence)
    return () => {
      offUsers()
      offStatus()
    }
  }, [session, onPresence, onStatus])

  useEffect(() => {
    if (!onStats) return
    const tick = () => onStats({ ...session.provider.stats })
    tick()
    const timer = setInterval(tick, 30_000)
    return () => {
      clearInterval(timer)
      tick()
    }
  }, [session, onStats])

  return (
    <>
      {tooLarge && (
        <p className="canvas-banner" role="alert">
          El canvas pasó el máximo de 600.000 caracteres: los últimos cambios no se guardan.
          Eliminá tarjetas o acortá su texto, y exportá el archivo para no perderlo.
        </p>
      )}
      <CanvasSurface
        ycanvas={ycanvas}
        editable={editable}
        isMobile={isMobile}
        files={files}
        onOpenNote={onOpenNote}
      />
    </>
  )
}
