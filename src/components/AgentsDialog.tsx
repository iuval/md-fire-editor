import { useState } from 'react'
import { Bot, Check, Pencil, X } from 'lucide-react'
import { Modal } from './Modal'
import { ROLE_LABELS, type Folder, type Role } from '../lib/notes'
import { cleanAgentName, MAX_AGENT_NAME, type Agent } from '../lib/agents'

interface AgentsDialogProps {
  agents: Agent[]
  /** Error del listener de Firestore, si la lista no se pudo leer. */
  error?: string | null
  folders: Folder[]
  onRename: (agentId: string, name: string) => Promise<void>
  onLink: (agentUid: string, folder: Folder, role: Role) => Promise<void>
  onClose: () => void
}

/** "hace 2 min", sin dependencias: la lista es corta y se refresca sola. */
function since(date: Date | null): string {
  if (!date) return 'sin uso'
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} días`
}

/**
 * Los agentes conectados a esta cuenta. Cada sesión de la CLI se registra sola
 * al loguearse con tu cuenta, así que no hay códigos que pegar: acá se ve la
 * lista y se le pone nombre. El nombre también se cambia desde la terminal con
 * `mdfire name`.
 *
 * El pareado por uid sigue disponible para el modo `login --agent`, que crea
 * una cuenta anónima aparte en vez de usar la tuya.
 */
export function AgentsDialog({ agents, error: listError, folders, onRename, onLink, onClose }: AgentsDialogProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [uid, setUid] = useState('')
  const [folderId, setFolderId] = useState(folders[0]?.id ?? '')
  const [role, setRole] = useState<Role>('editor')
  const [done, setDone] = useState<string | null>(null)

  const startRename = (agent: Agent) => {
    setEditing(agent.id)
    setDraft(agent.name)
    setError(null)
  }

  const saveRename = async (agentId: string) => {
    const name = cleanAgentName(draft)
    if (!name) {
      setError('El nombre no puede quedar vacío')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onRename(agentId, name)
      setEditing(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitLink = async () => {
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
    <Modal labelledBy="agents-heading" onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="agents-heading">Agentes conectados</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <X size={15} />
        </button>
      </div>

      <p className="share-hint-box">
        Cada sesión de la CLI que entra con tu cuenta aparece acá. Cambiale el nombre desde la app
        o con <code>mdfire name</code>; el id no cambia nunca. La guía para agentes está en{' '}
        <a href="https://firemd.app/agent.md" target="_blank" rel="noreferrer">
          firemd.app/agent.md
        </a>
        .
      </p>

      {listError && (
        <p className="hint tone-danger">
          No se pudo cargar la lista: {listError}. Si acabás de actualizar la app, las reglas
          nuevas todavía no están publicadas.
        </p>
      )}

      {agents.length === 0 ? (
        <p className="hint">
          Todavía no hay agentes. Instalá la CLI y corré <code>mdfire login</code>: se registra solo.
        </p>
      ) : (
        <ul className="agent-list">
          {agents.map((agent) => (
            <li key={agent.id} className="agent-row">
              <Bot size={14} aria-hidden="true" />
              {editing === agent.id ? (
                <>
                  <input
                    className="field"
                    value={draft}
                    maxLength={MAX_AGENT_NAME}
                    aria-label={`Nombre de ${agent.name}`}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(agent.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                  <button
                    className="icon-btn"
                    onClick={() => void saveRename(agent.id)}
                    disabled={busy}
                    aria-label="Guardar nombre"
                  >
                    <Check size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancelar">
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="agent-name">{agent.name}</span>
                  <span className="hint agent-meta">
                    {agent.kind} · {since(agent.lastSeenAt)}
                  </span>
                  <button
                    className="icon-btn"
                    onClick={() => startRename(agent)}
                    aria-label={`Renombrar ${agent.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="agent-anon">
        <summary>Vincular un agente anónimo (opcional)</summary>
        <p className="hint">
          <code>mdfire login --agent</code> crea una cuenta aparte en vez de usar la tuya. Esa
          cuenta sólo ve la carpeta que le des, y podés quitársela desde Compartir.
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
          <button className="btn" onClick={() => void submitLink()} disabled={busy || !uid.trim()}>
            <Bot size={13} /> Vincular
          </button>
        </div>

        {done && <p className="hint tone-ok">{done}</p>}
      </details>

      {error && <p className="hint tone-danger">{error}</p>}
    </Modal>
  )
}
