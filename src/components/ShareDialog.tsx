import { useEffect, useState } from 'react'
import { Check, Copy, Globe, Lock, X } from 'lucide-react'
import type { Note, NoteAccess } from '../lib/notes'

interface ShareDialogProps {
  note: Note
  onClose: () => void
  onChangeAccess: (access: NoteAccess) => Promise<void>
}

export function ShareDialog({ note, onClose, onChangeAccess }: ShareDialogProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `${window.location.origin}/?note=${note.id}`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('No se pudo copiar')
    }
  }

  const changeAccess = async (access: NoteAccess) => {
    setBusy(true)
    setError(null)
    try {
      await onChangeAccess(access)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="share-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 id="share-heading">Compartir</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className="share-option"
            aria-pressed={note.access === 'restricted'}
            disabled={busy}
            onClick={() => void changeAccess('restricted')}
          >
            <Lock size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <span className="share-option-title">Privada</span>
              <span className="share-option-desc" style={{ display: 'block' }}>
                Solo vos y las personas con acceso directo.
              </span>
            </span>
          </button>

          <button
            className="share-option"
            aria-pressed={note.access === 'link-edit'}
            disabled={busy}
            onClick={() => void changeAccess('link-edit')}
          >
            <Globe size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <span className="share-option-title">Cualquiera con el enlace puede editar</span>
              <span className="share-option-desc" style={{ display: 'block' }}>
                Edición simultánea en tiempo real. Requiere iniciar sesión con Google.
              </span>
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace para compartir" />
          <button className="btn" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>

        <p className="hint">
          {note.memberIds.length} {note.memberIds.length === 1 ? 'persona con acceso directo' : 'personas con acceso directo'}
          {note.access === 'link-edit' ? ' · el enlace está activo' : ''}
        </p>

        {error && <p className="hint" style={{ color: '#e05252' }}>{error}</p>}
      </div>
    </>
  )
}
