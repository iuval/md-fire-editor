import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Globe, Link2, Lock, Pencil, Trash2, X } from 'lucide-react'
import {
  ACCESS_LABELS,
  ROLE_LABELS,
  aclMembers,
  type Access,
  type Acl,
  type Role,
} from '../lib/notes'
import { getProfileName, lookupByEmail } from '../lib/directory'
import { Modal } from './Modal'

export interface ShareTarget {
  kind: 'note' | 'folder'
  id: string
  name: string
  acl: Acl
  ownerId: string
  /** Set when a note inherits its ACL from a folder. */
  inheritedFrom?: { id: string; name: string } | null
}

interface ShareDialogProps {
  target: ShareTarget
  onChangeAccess: (access: Access) => Promise<void>
  onAddMember: (uid: string, role: Role) => Promise<void>
  onSetRole: (uid: string, role: Role) => Promise<void>
  onRemoveMember: (uid: string) => Promise<void>
  onOpenFolder?: (folderId: string) => void
  currentUid: string
  onClose: () => void
}

export function ShareDialog({
  target,
  onChangeAccess,
  onAddMember,
  onSetRole,
  onRemoveMember,
  onOpenFolder,
  currentUid,
  onClose,
}: ShareDialogProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('editor')
  const [names, setNames] = useState<Record<string, string>>({})

  const inherited = target.kind === 'note' && !!target.inheritedFrom
  const link = `${window.location.origin}/?note=${target.id}`

  const members = useMemo(() => aclMembers(target.acl), [target.acl])

  // Resolve display names for members we don't know yet.
  useEffect(() => {
    let cancelled = false
    const missing = members.map((m) => m.uid).filter((uid) => !(uid in names))
    if (missing.length === 0) return
    void Promise.all(
      missing.map(async (uid) => [uid, (await getProfileName(uid)) ?? uid.slice(0, 8)] as const)
    ).then((entries) => {
      if (cancelled) return
      setNames((prev) => {
        const next = { ...prev }
        for (const [uid, name] of entries) next[uid] = name
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [members, names])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('No se pudo copiar el enlace')
    }
  }

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
      } catch (e) {
        const message = (e as Error).message
        setError(
          message.includes('inherits')
            ? 'Esta nota hereda los permisos de su carpeta.'
            : message
        )
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const addByEmail = async () => {
    const value = email.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const entry = await lookupByEmail(value)
      if (!entry) {
        setError('Esa persona tiene que entrar al menos una vez con Google para poder agregarla.')
        return
      }
      if (members.some((m) => m.uid === entry.uid)) {
        setError('Ya tiene acceso.')
        return
      }
      setNames((prev) => ({ ...prev, [entry.uid]: entry.name }))
      await onAddMember(entry.uid, newRole)
      setEmail('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal labelledBy="share-heading" onClose={onClose}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="share-heading">
            Compartir {target.kind === 'folder' ? 'carpeta' : 'nota'} «{target.name || 'Sin título'}»
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        {inherited ? (
          <>
            <p className="share-hint-box">
              Esta nota hereda los permisos de la carpeta «{target.inheritedFrom!.name}». Para
              cambiar quién puede leerla o editarla, compartí la carpeta.
            </p>
            {onOpenFolder && (
              <button className="btn ghost" onClick={() => onOpenFolder(target.inheritedFrom!.id)}>
                <Link2 size={13} /> Compartir la carpeta
              </button>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <AccessOption
                active={target.acl.access === 'restricted'}
                disabled={busy}
                icon={<Lock size={14} />}
                title={ACCESS_LABELS.restricted}
                description="Solo las personas de la lista."
                onClick={() => void run(() => onChangeAccess('restricted'))}
              />
              <AccessOption
                active={target.acl.access === 'link-view'}
                disabled={busy}
                icon={<Globe size={14} />}
                title={ACCESS_LABELS['link-view']}
                description="Cualquiera con el enlace puede leer, nadie puede escribir."
                onClick={() => void run(() => onChangeAccess('link-view'))}
              />
              <AccessOption
                active={target.acl.access === 'link-edit'}
                disabled={busy}
                icon={<Pencil size={14} />}
                title={ACCESS_LABELS['link-edit']}
                description="Cualquiera con el enlace puede editar en tiempo real."
                onClick={() => void run(() => onChangeAccess('link-edit'))}
              />
            </div>

            {target.kind === 'note' ? (
              <div className="row">
                <input
                  className="field"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Enlace para compartir"
                />
                <button className="btn" onClick={() => void copy()}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            ) : (
              <p className="share-hint-box">
                Las notas de esta carpeta heredan estos permisos. Compartí el enlace de una nota
                para que alguien entre a editarla.
              </p>
            )}

            <div>
              <p className="hint" style={{ marginBottom: 4 }}>Personas con acceso</p>
              <div className="member-list">
                {members.map(({ uid, role }) => {
                  const isOwner = role === 'owner'
                  return (
                    <div className="member-row" key={uid}>
                      <span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>
                        {(names[uid] ?? uid).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="member-name" title={uid}>
                        {names[uid] ?? uid.slice(0, 8)}
                        {uid === currentUid ? ' (vos)' : ''}
                      </span>
                      {isOwner ? (
                        <span className="hint">{ROLE_LABELS.owner}</span>
                      ) : (
                        <>
                          <select
                            className="role-select"
                            value={role}
                            aria-label={`Permiso de ${names[uid] ?? uid}`}
                            disabled={busy}
                            onChange={(e) =>
                              void run(() => onSetRole(uid, e.target.value as Role))
                            }
                          >
                            <option value="viewer">{ROLE_LABELS.viewer}</option>
                            <option value="editor">{ROLE_LABELS.editor}</option>
                          </select>
                          <button
                            className="icon-btn icon-btn--sm"
                            aria-label={`Quitar acceso a ${names[uid] ?? uid}`}
                            disabled={busy}
                            onClick={() => void run(() => onRemoveMember(uid))}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="row">
              <input
                className="field"
                type="email"
                placeholder="persona@gmail.com"
                value={email}
                aria-label="Agregar persona por email"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addByEmail()
                }}
              />
              <select
                className="role-select"
                value={newRole}
                aria-label="Permiso para la nueva persona"
                onChange={(e) => setNewRole(e.target.value as Role)}
              >
                <option value="viewer">{ROLE_LABELS.viewer}</option>
                <option value="editor">{ROLE_LABELS.editor}</option>
              </select>
              <button className="btn" disabled={busy || !email.trim()} onClick={() => void addByEmail()}>
                Agregar
              </button>
            </div>

            <p className="hint">
              Lector: puede abrir y ver. Escritura: puede editar, y en notas compartidas también
              escribe en tiempo real.
            </p>
          </>
        )}

        {error && <p className="hint tone-danger">{error}</p>}
    </Modal>
  )
}

function AccessOption({
  active,
  disabled,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  disabled: boolean
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      className="share-option"
      aria-pressed={active}
      disabled={disabled || active}
      onClick={onClick}
    >
      <span style={{ marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <span>
        <span className="share-option-title">{title}</span>
        <span className="share-option-desc" style={{ display: 'block' }}>
          {description}
        </span>
      </span>
    </button>
  )
}
