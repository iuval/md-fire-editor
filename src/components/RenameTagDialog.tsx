import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface RenameTagDialogProps {
  current: string
  knownTags: string[]
  onRename: (from: string, to: string) => void
  onClose: () => void
}

/** Renames (or merges) a tag across every note the user can write. */
export function RenameTagDialog({ current, knownTags, onRename, onClose }: RenameTagDialogProps) {
  const [from, setFrom] = useState(current)
  const [to, setTo] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const source = from.trim().replace(/^#/, '')
    const target = to.trim().replace(/^#/, '')
    if (!source || !target) return
    onRename(source, target)
    onClose()
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="rename-tag-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="rename-tag-heading">Renombrar etiqueta</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <label className="hint" htmlFor="rename-from">
          Etiqueta actual
        </label>
        <input
          id="rename-from"
          className="field"
          list="known-tags"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          spellCheck={false}
        />
        <datalist id="known-tags">
          {knownTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>

        <label className="hint" htmlFor="rename-to">
          Nueva etiqueta (si ya existe, se fusionan)
        </label>
        <input
          id="rename-to"
          className="field"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          spellCheck={false}
        />

        <p className="hint">
          Se reescriben las notas que puedas editar. Las que no tengas permiso de escritura quedan
          como están.
        </p>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" onClick={submit} disabled={!from.trim() || !to.trim()}>
            Renombrar
          </button>
        </div>
      </div>
    </>
  )
}
