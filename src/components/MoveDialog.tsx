import { Folder, X } from 'lucide-react'
import { Modal } from './Modal'
import type { Folder as FolderType } from '../lib/notes'

interface MoveDialogProps {
  noteTitle: string
  folders: FolderType[]
  currentFolderId: string | null
  onMove: (folder: FolderType | null) => void
  onClose: () => void
}

export function MoveDialog({ noteTitle, folders, currentFolderId, onMove, onClose }: MoveDialogProps) {
  return (
    <Modal labelledBy="move-heading" onClose={onClose}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="move-heading">Mover «{noteTitle || 'Sin título'}»</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <p className="hint">Al moverla, la nota pasa a usar los permisos de la carpeta destino.</p>

        <div className="member-list">
          <button
            className="menu-item"
            onClick={() => {
              onMove(null)
              onClose()
            }}
            aria-current={currentFolderId === null ? 'true' : undefined}
          >
            <Folder size={13} /> Sin carpeta (solo vos)
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className="menu-item"
              onClick={() => {
                onMove(folder)
                onClose()
              }}
              aria-current={currentFolderId === folder.id ? 'true' : undefined}
            >
              <Folder size={13} /> {folder.name}
            </button>
          ))}
        </div>

        {folders.length === 0 && <p className="hint">Todavía no tenés carpetas.</p>}
    </Modal>
  )
}
