import { useState } from 'react'
import { Bot, Check, Pencil, X } from 'lucide-react'
import { Modal } from './Modal'
import { roleLabel, type Folder, type Role } from '../lib/notes'
import { cleanAgentName, MAX_AGENT_NAME, type Agent } from '../lib/agents'
import { t, useT } from '../i18n/index.ts'

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
  if (!date) return t('agents.never')
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return t('agents.justNow')
  if (minutes < 60) return t('agents.minutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('agents.hoursAgo', { count: hours })
  const days = Math.round(hours / 24)
  return days === 1 ? t('agents.yesterday') : t('agents.daysAgo', { count: days })
}

/**
 * Los agentes conectados a esta cuenta. Cada sesión de la CLI se registra sola
 * al loguearse con tu cuenta, así que no hay códigos que pegar: acá se ve la
 * lista y se le pone nombre. El nombre también se cambia desde la terminal con
 * `firemd name`.
 *
 * El pareado por uid sigue disponible para el modo `login --agent`, que crea
 * una cuenta anónima aparte en vez de usar la tuya.
 */
export function AgentsDialog({ agents, error: listError, folders, onRename, onLink, onClose }: AgentsDialogProps) {
  const t = useT()
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
      setError(t('error.emptyAgentName'))
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
      setError(t('agents.pickFolder'))
      return
    }
    if (!/^[A-Za-z0-9]{16,40}$/.test(clean)) {
      setError(t('agents.uidInvalid'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await onLink(clean, folder, role)
      setDone(
        t('agents.linked', {
          action: role === 'editor' ? t('agents.actionEdit') : t('agents.actionRead'),
          folder: folder.name,
        })
      )
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
        <h2 id="agents-heading">{t('agents.heading')}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      </div>

      <p className="share-hint-box">
        {t('agents.intro')}{' '}
        <a href="https://firemd.app/agent.md" target="_blank" rel="noreferrer">
          firemd.app/agent.md
        </a>
        .
      </p>

      {listError && (
        <p className="hint tone-danger">
          {t('agents.listError', { message: listError })}
        </p>
      )}

      {agents.length === 0 ? (
        <p className="hint">
          {t('agents.empty')}
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
                    aria-label={t('agents.nameOf', { name: agent.name })}
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
                    aria-label={t('agents.saveName')}
                  >
                    <Check size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditing(null)} aria-label={t('common.cancel')}>
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
                    aria-label={t('agents.renameOf', { name: agent.name })}
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
        <summary>{t('agents.anonTitle')}</summary>
        <p className="hint">
          {t('agents.anonHelp')}
        </p>

        <label className="hint" htmlFor="agent-uid">
          {t('agents.uidLabel')}
        </label>
        <input
          id="agent-uid"
          className="field"
          placeholder={t('agents.uidPlaceholder')}
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="row">
          <select
            className="field"
            value={folderId}
            aria-label={t('agents.folder')}
            onChange={(e) => setFolderId(e.target.value)}
          >
            {folders.length === 0 && <option value="">{t('agents.createFolderFirst')}</option>}
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <select
            className="role-select"
            value={role}
            aria-label={t('agents.role')}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="viewer">{roleLabel('viewer')}</option>
            <option value="editor">{roleLabel('editor')}</option>
          </select>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => void submitLink()} disabled={busy || !uid.trim()}>
            <Bot size={13} /> {t('agents.link')}
          </button>
        </div>

        {done && <p className="hint tone-ok">{done}</p>}
      </details>

      {error && <p className="hint tone-danger">{error}</p>}
    </Modal>
  )
}
