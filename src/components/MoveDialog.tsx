import { Check, Folder, Inbox, X } from 'lucide-react'
import { Modal } from './Modal'
import type { Folder as FolderType } from '../lib/notes'
import { useT } from '../i18n/index.ts'

interface MoveDialogProps {
  noteTitle: string
  folders: FolderType[]
  currentFolderId: string | null
  onMove: (folder: FolderType | null) => void
  onClose: () => void
}

export function MoveDialog({ noteTitle, folders, currentFolderId, onMove, onClose }: MoveDialogProps) {
  const t = useT()
  return (
    <Modal labelledBy="move-heading" onClose={onClose}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="move-heading">{t('move.heading', { name: noteTitle || t('app.untitled') })}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>

        <p className="hint">{t('move.hint')}</p>

        <div className="move-list">
          <button
            className={`move-card${currentFolderId === null ? ' is-current' : ''}`}
            onClick={() => {
              onMove(null)
              onClose()
            }}
            aria-current={currentFolderId === null ? 'true' : undefined}
          >
            <span className="move-icon">
              <Inbox size={15} />
            </span>
            <span className="move-text">
              <span className="move-title">{t('move.noFolder')}</span>
              <span className="move-hint">{t('move.noFolderHint')}</span>
            </span>
            {currentFolderId === null && <Check size={14} className="move-check" />}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={`move-card${currentFolderId === folder.id ? ' is-current' : ''}`}
              onClick={() => {
                onMove(folder)
                onClose()
              }}
              aria-current={currentFolderId === folder.id ? 'true' : undefined}
            >
              <span className="move-icon">
                <Folder size={15} />
              </span>
              <span className="move-text">
                <span className="move-title">{folder.name}</span>
                <span className="move-hint">{t('move.folder')}</span>
              </span>
              {currentFolderId === folder.id && <Check size={14} className="move-check" />}
            </button>
          ))}
        </div>

        {folders.length === 0 && <p className="hint">{t('move.empty')}</p>}
    </Modal>
  )
}
