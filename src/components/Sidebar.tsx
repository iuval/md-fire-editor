import { useEffect, useState } from 'react'
import { ChevronRight, Folder, Link2, MoreHorizontal, PanelLeftClose, Plus, User } from 'lucide-react'
import type { Folder as FolderType, Note } from '../lib/notes'
import { buildFolderTree, type FolderNode } from '../lib/folders'
import { sortFolders, sortNotes, type SortMode } from '../lib/sorting'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STEP,
  TREE_CONTAINER_PAD,
  clampSidebarWidth,
  guideIndent,
  rowIndent,
} from '../lib/sidebarLayout'
import type { TagNode } from '../lib/tags'

export interface SidebarProps {
  notes: Note[]
  folders: FolderType[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewNote: (folder?: FolderType) => void
  onHeaderMenu: (pos: { x: number; y: number }) => void
  rootSort: SortMode
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

const TAGS_KEY = 'mdfire-tags-open'
const WIDTH_KEY = 'mdfire-sidebar-width'

function initialWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    return raw === null ? DEFAULT_SIDEBAR_WIDTH : clampSidebarWidth(Number(raw))
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

/** Tags start collapsed: the file tree is what the sidebar is for. */
function initialTagsOpen(): boolean {
  try {
    return localStorage.getItem(TAGS_KEY) === '1'
  } catch {
    return false
  }
}

export function Sidebar({
  notes,
  folders,
  activeId,
  onSelect,
  onNewNote,
  onHeaderMenu,
  rootSort,
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
  const [width, setWidth] = useState(initialWidth)
  const [tagsOpen, setTagsOpen] = useState(initialTagsOpen)

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width))
    } catch {
      /* ignore */
    }
  }, [width])

  const toggleTags = () => {
    const next = !tagsOpen
    setTagsOpen(next)
    try {
      localStorage.setItem(TAGS_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  /**
   * Drag the right edge. The listeners live on `window` so the pointer may
   * leave the 6px strip (or the panel) without dropping the resize.
   */
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const handle = event.currentTarget
    if (event.pointerId != null) handle.setPointerCapture?.(event.pointerId)

    const onMove = (move: PointerEvent) => setWidth(clampSidebarWidth(startWidth + move.clientX - startX))
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const onResizerKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowLeft'
        ? -SIDEBAR_WIDTH_STEP
        : event.key === 'ArrowRight'
          ? SIDEBAR_WIDTH_STEP
          : 0
    if (delta) {
      event.preventDefault()
      setWidth(clampSidebarWidth(width + delta))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(MIN_SIDEBAR_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(MAX_SIDEBAR_WIDTH)
    }
  }

  const rootNotes = sortNotes(notes.filter((n) => !n.folderId), rootSort)
  const byId = new Map(folders.map((f) => [f.id, f]))
  const sortOf = (folderId: string | null): SortMode => {
    let current = folderId
    let guard = 0
    while (current && guard++ < 32) {
      const folder = byId.get(current)
      if (!folder) break
      if (folder.sort) return folder.sort
      current = folder.parentId
    }
    return rootSort
  }
  const notesOf = (folderId: string) => sortNotes(notes.filter((n) => n.folderId === folderId), sortOf(folderId))
  const tree = buildFolderTree(folders)
  const sortTree = (nodes: FolderNode[]): FolderNode[] => {
    const ordered = sortFolders(nodes.map((n) => n.folder), sortOf(nodes[0]?.folder.parentId ?? null))
      .map((folder) => nodes.find((n) => n.folder.id === folder.id)!)
      .filter(Boolean)
    return ordered
  }

  const noteButton = (note: Note, padLeft: number) => {
    const shared = note.memberIds.length > 1 || note.access !== 'restricted'
    return (
      <button
        key={note.id}
        className={`file-item${note.id === activeId ? ' active' : ''}`}
        onClick={() => onSelect(note.id)}
        aria-current={note.id === activeId ? 'true' : undefined}
        style={{ paddingLeft: padLeft }}
      >
        <span className="file-name">
          {shared && <Link2 size={10} style={{ marginRight: 4, opacity: 0.55, verticalAlign: 'middle' }} />}
          {note.title || 'Sin título'}
        </span>
      </button>
    )
  }

  return (
    <aside
      className={`sidebar${isOpen ? ' open' : ''}${!isOpen && !isMobile ? ' collapsed' : ''}`}
      style={{ '--sidebar-w': `${width}px` } as React.CSSProperties}
      aria-label="Notas y carpetas"
      aria-hidden={isOpen ? undefined : true}
    >
      <div className="sidebar-head">
        <span className="sidebar-title">Notas</span>
        <button className="icon-btn" onClick={() => onNewNote()} aria-label="Nueva nota" title="Nueva nota">
          <Plus size={15} />
        </button>
        <button
          className="icon-btn"
          aria-label="Más acciones"
          title="Más acciones"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            onHeaderMenu({ x: rect.left - 150, y: rect.bottom + 4 })
          }}
        >
          <MoreHorizontal size={15} />
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
          <div className="tag-panel-head">
            <button
              className="tag-panel-toggle"
              onClick={toggleTags}
              aria-expanded={tagsOpen}
              aria-controls="tag-tree"
              title={tagsOpen ? 'Ocultar etiquetas' : 'Mostrar etiquetas'}
            >
              <ChevronRight size={11} className={`chev${tagsOpen ? ' open' : ''}`} />
              <span className="sidebar-section-label">Etiquetas</span>
              <span className="tag-panel-count">{tagTree.length}</span>
            </button>
            {selectedTags.length > 0 && (
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => selectedTags.forEach((tag) => onToggleTag(tag))}
                aria-label="Quitar filtro de etiquetas"
                title="Quitar filtro"
              >
                ✕
              </button>
            )}
          </div>
          {tagsOpen && (
            <div className="tag-tree" id="tag-tree">
              <div className="tag-tree-rows">
                {tagTree.map((node) => (
                  <button
                    key={node.key}
                    className={`tag-tree-row${selectedTags.includes(node.key) ? ' active' : ''}`}
                    style={{ paddingLeft: rowIndent(node.depth) }}
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
        </div>
      )}

      <div className="file-list">
        <div className="file-tree">
          {loading && <p className="hint" style={{ padding: '10px 8px' }}>Cargando…</p>}

          {!loading && notes.length === 0 && folders.length === 0 && (
            <p className="hint" style={{ padding: '10px 8px' }}>Sin notas todavía.</p>
          )}

          {(() => {
            const renderNode = (node: FolderNode): React.ReactNode => {
              const folder = node.folder
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
                      aria-label={`${node.path}: ${isOpenFolder ? 'ocultar' : 'mostrar'} contenido`}
                      style={{ paddingLeft: rowIndent(node.depth) }}
                    >
                      <ChevronRight size={12} className={`chev${isOpenFolder ? ' open' : ''}`} />
                      <Folder size={13} style={{ flexShrink: 0, opacity: 0.75 }} />
                      <span className="folder-name" title={node.path}>
                        {folder.name}
                      </span>
                      {shared && <Link2 size={10} style={{ opacity: 0.55, flexShrink: 0 }} />}
                      {folder.tags.length > 0 && (
                        <span className="folder-tag" title={folder.tags.map((t) => `#${t}`).join(' ')}>
                          #{folder.tags[0]}
                          {folder.tags.length > 1 ? `+${folder.tags.length - 1}` : ''}
                        </span>
                      )}
                      {/* The count is only useful while the children are hidden; when the
                          folder is open it repeats what you can already see. */}
                      {!isOpenFolder && <span className="folder-count">{children.length}</span>}
                    </button>
                    <button
                      className="icon-btn icon-btn--sm"
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
                    <div
                      className="tree-notes"
                      style={
                        {
                          paddingLeft: TREE_CONTAINER_PAD,
                          '--guide-x': `${guideIndent(node.depth)}px`,
                        } as React.CSSProperties
                      }
                    >
                      {node.children.length === 0 && children.length === 0 && (
                        <p className="tree-empty">Vacía</p>
                      )}
                      {sortTree(node.children).map((child) => renderNode(child))}
                      {children.map((note) => noteButton(note, rowIndent(node.depth + 1)))}
                    </div>
                  )}
                </div>
              )
            }

            return sortTree(tree).map((node) => renderNode(node))
          })()}

          {rootNotes.length > 0 && folders.length > 0 && (
            <div className="sidebar-section">
              <span className="sidebar-section-label">Sin carpeta</span>
            </div>
          )}

          {rootNotes.map((note) => noteButton(note, rowIndent(0)))}
        </div>
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

      {/* Splitter: mouse/touch drag on the edge, arrows/Home/End from the keyboard. */}
      {!isMobile && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ancho del panel"
          aria-valuenow={width}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          tabIndex={0}
          title="Arrastrá para cambiar el ancho (doble clic para restablecer)"
          onPointerDown={startResize}
          onKeyDown={onResizerKey}
          onDoubleClick={() => setWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      )}
    </aside>
  )
}
