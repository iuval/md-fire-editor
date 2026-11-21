import { useEffect, useState } from 'react'
import { Bot, X } from 'lucide-react'
import { ROLE_LABELS, type Folder, type Role } from '../lib/notes'

interface AgentsDialogProps {
  folders: Folder[]
  onLink: (agentUid: string, folder: Folder, role: Role) => Promise<void>
  onClose: () => void
}

/**
 * Pairs an agent with a folder. The agent is just another Firebase user (an
 * anonymous account created by `mdfire login`), so linking it is a normal
 * member add — and removing it from the folder revokes it instantly.
 */
export function AgentsDialog({ folders, onLink, onClose }: AgentsDialogProps) {
  const [uid, setUid] = useState('')
  const [folderId, setFolderId] = useState(folders[0]?.id ?? '')
  const [role, setRole] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const clean = uid.trim()
    const folder = folders.find((f) => f.id === folderId)
    if (!folder) {
      setError('Elegí una carpeta')
      return
    }
    if (!/^[A-Za-z0-9]{16,40}$/.test(clean)) {
      setError('El uid tiene 28 caracteres. Copialo de `mdfire whoami`.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await onLink(clean, folder, role)
      setDone(`Listo: el agente ya puede ${role === 'editor' ? 'editar' : 'leer'} «${folder.name}».`)
      setUid('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="agents-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="agents-heading">Agentes de IA</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <p className="share-hint-box">
          El agente es una cuenta propia, no la tuya: solo ve las notas de la carpeta que le
          des, y podés quitarle el acceso cuando quieras desde Compartir.
        </p>

        <label className="hint" htmlFor="agent-uid">
          Uid del agente (te lo da <code>mdfire whoami</code>)
        </label>
        <input
          id="agent-uid"
          className="field"
          placeholder="p. ej. Xk2mQ9vT4bLpR7sN1cZ8hJ3dF5gA"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="row">
          <select
            className="field"
            value={folderId}
            aria-label="Carpeta"
            onChange={(e) => setFolderId(e.target.value)}
          >
            {folders.length === 0 && <option value="">(creá una carpeta primero)</option>}
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <select
            className="role-select"
            value={role}
            aria-label="Permiso del agente"
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="viewer">{ROLE_LABELS.viewer}</option>
            <option value="editor">{ROLE_LABELS.editor}</option>
          </select>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => void submit()} disabled={busy || !uid.trim()}>
            <Bot size={13} /> Vincular
          </button>
        </div>

        {done && <p className="hint" style={{ color: '#3fa65c' }}>{done}</p>}
        {error && <p className="hint" style={{ color: '#e05252' }}>{error}</p>}
      </div>
    </>
  )
}
