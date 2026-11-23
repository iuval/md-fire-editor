import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Globe, Link2, Lock, Pencil, Trash2, X } from 'lucide-react'
import {
  accessLabel,
  roleLabel,
  aclMembers,
  type Access,
  type Acl,
  type Role,
} from '../lib/notes'
import { getProfileName, lookupByEmail } from '../lib/directory'
import { Modal } from './Modal'
import { useT } from '../i18n/index.ts'

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
  const t = useT()
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
  }, [members, names, t])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(t('share.copyFailed'))
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
            ? t('share.inheritsPermission')
            : message
        )
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  const addByEmail = async () => {
    const value = email.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const entry = await lookupByEmail(value)
      if (!entry) {
        setError(t('share.noAccount'))
        return
      }
      if (members.some((m) => m.uid === entry.uid)) {
        setError(t('share.alreadyHasAccess'))
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
            {t('share.heading', {
              kind: target.kind === 'folder' ? t('share.folder') : t('share.note'),
              name: target.name || t('app.untitled'),
            })}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('share.close')}>
            <X size={15} />
          </button>
        </div>

        {inherited ? (
          <>
            <p className="share-hint-box">
              {t('share.inheritedBox', { folder: target.inheritedFrom!.name })}
            </p>
            {onOpenFolder && (
              <button className="btn ghost" onClick={() => onOpenFolder(target.inheritedFrom!.id)}>
                <Link2 size={13} /> {t('share.shareFolder')}
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
                title={accessLabel('restricted')}
                description={t('share.restrictedHint')}
                onClick={() => void run(() => onChangeAccess('restricted'))}
              />
              <AccessOption
                active={target.acl.access === 'link-view'}
                disabled={busy}
                icon={<Globe size={14} />}
                title={accessLabel('link-view')}
                description={t('share.linkViewHint')}
                onClick={() => void run(() => onChangeAccess('link-view'))}
              />
              <AccessOption
                active={target.acl.access === 'link-edit'}
                disabled={busy}
                icon={<Pencil size={14} />}
                title={accessLabel('link-edit')}
                description={t('share.linkEditHint')}
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
                  aria-label={t('share.linkLabel')}
                />
                <button className="btn" onClick={() => void copy()}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? t('share.copied') : t('share.copy')}
                </button>
              </div>
            ) : (
              <p className="share-hint-box">
                {t('share.folderInherits')}
              </p>
            )}

            <div>
              <p className="hint" style={{ marginBottom: 4 }}>{t('share.members')}</p>
              <div className="member-list">
                {members.map(({ uid, role }) => {
                  const isOwner = role === 'owner'
                  return (
                    <div className="member-card" key={uid}>
                      <span className="member-avatar" aria-hidden="true">
                        {(names[uid] ?? uid).slice(0, 1).toUpperCase()}
                      </span>
                      <div className="member-main">
                        <span className="member-name" title={uid}>
                          {names[uid] ?? uid.slice(0, 8)}
                          {uid === currentUid ? ` (${t('share.you')})` : ''}
                        </span>
                        <span className="member-role">
                          {isOwner ? roleLabel('owner') : roleLabel(role)}
                        </span>
                      </div>
                      {isOwner ? (
                        <span className="role-pill is-owner">{roleLabel('owner')}</span>
                      ) : (
                        <>
                          <select
                            className="role-select"
                            value={role}
                            aria-label={t('share.roleOf', { name: names[uid] ?? uid })}
                            disabled={busy}
                            onChange={(e) =>
                              void run(() => onSetRole(uid, e.target.value as Role))
                            }
                          >
                            <option value="viewer">{roleLabel('viewer')}</option>
                            <option value="editor">{roleLabel('editor')}</option>
                          </select>
                          <button
                            className="icon-btn icon-btn--sm"
                            aria-label={t('share.removeAccess', { name: names[uid] ?? uid })}
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
                placeholder={t('share.emailPlaceholder')}
                value={email}
                aria-label={t('share.addByEmail')}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addByEmail()
                }}
              />
              <select
                className="role-select"
                value={newRole}
                aria-label={t('share.newPersonRole')}
                onChange={(e) => setNewRole(e.target.value as Role)}
              >
                <option value="viewer">{roleLabel('viewer')}</option>
                <option value="editor">{roleLabel('editor')}</option>
              </select>
              <button className="btn" disabled={busy || !email.trim()} onClick={() => void addByEmail()}>
                {t('share.add')}
              </button>
            </div>

            <p className="hint">
              {t('share.rolesHelp')}
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
      <span className="share-option-text">
        <span className="share-option-title">{title}</span>
        <span className="share-option-desc" style={{ display: 'block' }}>
          {description}
        </span>
      </span>
      {active && <Check size={14} className="share-option-check" aria-hidden="true" />}
    </button>
  )
}
