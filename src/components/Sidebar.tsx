import { ChevronRight, Folder, FolderPlus, Link2, MoreHorizontal, PanelLeftClose, Plus, User } from 'lucide-react'
import type { Folder as FolderType, Note } from '../lib/notes'
import type { TagNode } from '../lib/tags'

interface SidebarProps {
  notes: Note[]
  folders: FolderType[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewNote: (folder?: FolderType) => void
  onNewFolder: () => void
  onFolderMenu: (folder: FolderType, pos: { x: number; y: number }) => void
  expanded: Set<string>
  onToggleFolder: (id: string) => void
  onClose: () => void
  onCollapse: () => void
  isMobile: boolean
  isOpen: boolean
  loading: boolean
  tagTree: TagNode[]
  selectedTags: string[]
  onToggleTag: (tagKey: string) => void
  uid?: string
  userName?: string
  photoURL?: string | null
  onAccountClick: () => void
}

function formatDate(ts?: { seconds: number } | null) {
  if (!ts?.seconds) return ''
  return new Date(ts.seconds * 1000).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
}

function preview(markdown: string): string {
  return markdown.replace(/[#*`[\]!>_~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 56)
}

function fileMeta(note: Note) {
  return [formatDate(note.updatedAt), preview(note.markdown)].filter(Boolean).join(' · ') || 'Vacía'
}

export function Sidebar({
  notes,
  folders,
  activeId,
  onSelect,
  onNewNote,
  onNewFolder,
  onFolderMenu,
  expanded,
  onToggleFolder,
  onClose,
  onCollapse,
  isMobile,
  isOpen,
  loading,
  tagTree,
  selectedTags,
  onToggleTag,
  uid,
  userName,
  photoURL,
  onAccountClick,
}: SidebarProps) {
  const rootNotes = notes.filter((n) => !n.folderId)
  const notesOf = (folderId: string) => notes.filter((n) => n.folderId === folderId)

  const noteButton = (note: Note, indented: boolean) => {
    const shared = note.memberIds.length > 1 || note.access !== 'restricted'
    return (
      <button
        key={note.id}
        className={`file-item${note.id === activeId ? ' active' : ''}`}
        onClick={() => onSelect(note.id)}
        aria-current={note.id === activeId ? 'true' : undefined}
        style={indented ? { paddingLeft: 8 } : undefined}
      >
        <span className="file-name">
          {shared && <Link2 size={10} style={{ marginRight: 4, opacity: 0.55, verticalAlign: 'middle' }} />}
          {note.title || 'Sin título'}
        </span>
        <span className="file-meta">{fileMeta(note)}</span>
      </button>
    )
  }

  return (
    <aside
      className={`sidebar${isOpen ? ' open' : ''}`}
      aria-label="Notas y carpetas"
      aria-hidden={isMobile && !isOpen}
    >
      <div className="sidebar-head">
        <span className="sidebar-title">Notas</span>
        <button className="icon-btn" onClick={() => onNewNote()} aria-label="Nueva nota" title="Nueva nota">
          <Plus size={15} />
        </button>
        <button className="icon-btn" onClick={onNewFolder} aria-label="Nueva carpeta" title="Nueva carpeta">
          <FolderPlus size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={isMobile ? onClose : onCollapse}
          aria-label={isMobile ? 'Cerrar panel' : 'Ocultar panel'}
          title={isMobile ? 'Cerrar panel' : 'Ocultar panel'}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {tagTree.length > 0 && (
        <div className="tag-panel" aria-label="Filtrar por etiqueta">
          <div className="sidebar-section" style={{ padding: '6px 8px 2px' }}>
            <span className="sidebar-section-label">Etiquetas</span>
            {selectedTags.length > 0 && (
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                onClick={() => selectedTags.forEach((tag) => onToggleTag(tag))}
                aria-label="Quitar filtro de etiquetas"
              >
                ✕
              </button>
            )}
          </div>
          <div className="tag-tree">
            {tagTree.map((node) => (
              <button
                key={node.key}
                className={`tag-tree-row${selectedTags.includes(node.key) ? ' active' : ''}`}
                style={{ paddingLeft: 8 + node.depth * 10 }}
                aria-pressed={selectedTags.includes(node.key)}
                onClick={() => onToggleTag(node.key)}
              >
                <span className="tag-tree-name">#{node.display}</span>
                <span className="tag-tree-count">{node.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="file-list">
        {loading && <p className="hint" style={{ padding: '10px 8px' }}>Cargando…</p>}

        {!loading && notes.length === 0 && folders.length === 0 && (
          <p className="hint" style={{ padding: '10px 8px' }}>Sin notas todavía.</p>
        )}

        {folders.map((folder) => {
          const children = notesOf(folder.id)
          const isOpenFolder = expanded.has(folder.id)
          const shared = folder.memberIds.length > 1 || folder.access !== 'restricted'

          return (
            <div key={folder.id}>
              <div className="folder-row">
                <button
                  className="folder-toggle"
                  onClick={() => onToggleFolder(folder.id)}
                  aria-expanded={isOpenFolder}
                  aria-label={`${folder.name}: ${isOpenFolder ? 'ocultar' : 'mostrar'} notas`}
                >
                  <ChevronRight size={12} className={`chev${isOpenFolder ? ' open' : ''}`} />
                  <Folder size={13} style={{ flexShrink: 0, opacity: 0.75 }} />
                  <span className="folder-name">{folder.name}</span>
                  {shared && <Link2 size={10} style={{ opacity: 0.55, flexShrink: 0 }} />}
                  {folder.tags.length > 0 && (
                    <span className="folder-count" title={folder.tags.map((t) => `#${t}`).join(' ')}>
                      #{folder.tags[0]}
                      {folder.tags.length > 1 ? `+${folder.tags.length - 1}` : ''}
                    </span>
                  )}
                  <span className="folder-count">{children.length}</span>
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  aria-label={`Acciones de ${folder.name}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    onFolderMenu(folder, { x: rect.left - 150, y: rect.bottom + 4 })
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>

              {isOpenFolder && (
                <div className="tree-notes">
                  {children.length === 0 ? (
                    <p className="tree-empty">Sin notas</p>
                  ) : (
                    children.map((note) => noteButton(note, true))
                  )}
                </div>
              )}
            </div>
          )
        })}

        {rootNotes.length > 0 && folders.length > 0 && (
          <div className="sidebar-section">
            <span className="sidebar-section-label">Sin carpeta</span>
          </div>
        )}

        {rootNotes.map((note) => noteButton(note, false))}
      </div>

      <div className="sidebar-foot">
        <button className="account" onClick={onAccountClick} aria-label="Cuenta y ajustes">
          {photoURL ? (
            <img className="avatar" src={photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar" aria-hidden="true">
              {uid ? <User size={11} /> : null}
            </span>
          )}
          <span className="account-name">{userName || 'Cuenta'}</span>
        </button>
      </div>
    </aside>
  )
}
