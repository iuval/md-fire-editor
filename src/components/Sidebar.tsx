import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ChevronRight,
  Folder,
  FolderPlus,
  Frame,
  SquareDashed,
  Link2,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Settings,
  User,
  X,
} from 'lucide-react'
import type { ProviderStatus } from '../lib/collab/provider'
import type { Folder as FolderType, Note } from '../lib/notes'
import { buildFolderTree, type FolderNode } from '../lib/folders'
import { applyOrderOverride, orderKey, sortFolders, sortNotes, type SortMode } from '../lib/sorting'
import { syncDetail, syncText, syncTone } from '../lib/syncStatus'
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
import { useT } from '../i18n/index.ts'

export interface SidebarProps {
  notes: Note[]
  folders: FolderType[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewNote: (folder?: FolderType) => void
  onNewFolder: () => void
  onNewCanvas: () => void
  /** Per-note actions (share, order, export, move, delete) live on the row. */
  onNoteMenu: (note: Note, pos: { x: number; y: number }) => void
  rootSort: SortMode
  /** Manual moves applied locally while the write is in flight. */
  orderOverrides?: Record<string, string[]>
  onFolderMenu: (folder: FolderType, pos: { x: number; y: number }) => void
  expanded: Set<string>
  onToggleFolder: (id: string) => void
  onClose: () => void
  onCollapse: () => void
  isMobile: boolean
  isOpen: boolean
  status: ProviderStatus
  loading: boolean
  tagTree: TagNode[]
  selectedTags: string[]
  onToggleTag: (tagKey: string) => void
  uid?: string
  userName?: string
  photoURL?: string | null
  onAccountClick: () => void
  /** Transient feedback (export, import, failed writes). Painted as a bell in
   *  the footer, never as a bar over the document. */
  notice?: string | null
  onDismissNotice?: () => void
}

const TAGS_KEY = 'firemd-tags-open'
const WIDTH_KEY = 'firemd-sidebar-width'

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
  onNewFolder,
  onNewCanvas,
  onNoteMenu,
  rootSort,
  orderOverrides,
  onFolderMenu,
  expanded,
  onToggleFolder,
  onClose,
  onCollapse,
  isMobile,
  isOpen,
  status,
  loading,
  tagTree,
  selectedTags,
  onToggleTag,
  uid,
  userName,
  photoURL,
  onAccountClick,
  notice,
  onDismissNotice,
}: SidebarProps) {
  const t = useT()
  const [width, setWidth] = useState(initialWidth)
  const [tagsOpen, setTagsOpen] = useState(initialTagsOpen)
  const [statusOpen, setStatusOpen] = useState(false)
  // Keyed by the message, so a new notice never inherits the previous one's
  // open bubble.
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const identityRef = useRef<HTMLDivElement>(null)

  // The status word and the notice are popovers in the footer: tap to read,
  // tap outside or press Escape to put them away.
  useEffect(() => {
    if (!statusOpen && openNotice === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatusOpen(false)
        setOpenNotice(null)
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!identityRef.current?.contains(e.target as Node)) {
        setStatusOpen(false)
        setOpenNotice(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [statusOpen, openNotice])

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

  const overrideOf = (kind: 'notes' | 'folders', parentId: string | null) =>
    applyOrderOverrideItems(kind, parentId)
  const applyOrderOverrideItems = (kind: 'notes' | 'folders', parentId: string | null) =>
    orderOverrides?.[orderKey(kind, parentId)]

  const rootNotes = applyOrderOverride(
    sortNotes(notes.filter((n) => !n.folderId), rootSort),
    overrideOf('notes', null)
  )
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
  const notesOf = (folderId: string) =>
    applyOrderOverride(
      sortNotes(notes.filter((n) => n.folderId === folderId), sortOf(folderId)),
      overrideOf('notes', folderId)
    )
  const tree = buildFolderTree(folders)
  const sortTree = (nodes: FolderNode[]): FolderNode[] => {
    const parentId = nodes[0]?.folder.parentId ?? null
    const ordered = applyOrderOverride(
      sortFolders(nodes.map((n) => n.folder), sortOf(parentId)),
      overrideOf('folders', parentId)
    )
      .map((folder) => nodes.find((n) => n.folder.id === folder.id)!)
      .filter(Boolean)
    return ordered
  }

  /** Pointer position for a row menu, anchored under the button that opened it. */
  const menuPos = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    return { x: rect.left - 150, y: rect.bottom + 4 }
  }

  const noteButton = (note: Note, padLeft: number) => {
    const shared = note.memberIds.length > 1 || note.access !== 'restricted'
    const title = note.title || t('app.untitled')
    return (
      <div
        key={note.id}
        className="file-row"
        // Same menu as the ⋯: right-clicking the row is the shortcut.
        onContextMenu={(event) => {
          event.preventDefault()
          onNoteMenu(note, { x: event.clientX, y: event.clientY })
        }}
      >
        <button
          className={`file-item${note.id === activeId ? ' active' : ''}`}
          onClick={() => onSelect(note.id)}
          aria-current={note.id === activeId ? 'true' : undefined}
          style={{ paddingLeft: padLeft }}
        >
          <span className="file-name">
            {shared && <Link2 size={10} style={{ marginRight: 4, opacity: 0.55, verticalAlign: 'middle' }} />}
            {note.kind === 'canvas' && (
              <Frame size={10} style={{ marginRight: 4, opacity: 0.55, verticalAlign: 'middle' }} />
            )}
            {title}
          </span>
        </button>
        <button
          className="icon-btn icon-btn--sm"
          aria-label={t('sidebar.noteActions', { title })}
          title={t('sidebar.noteActions', { title })}
          onClick={(event) => onNoteMenu(note, menuPos(event.currentTarget))}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    )
  }

  return (
    <aside
      className={`sidebar${isOpen ? ' open' : ''}${!isOpen && !isMobile ? ' collapsed' : ''}`}
      style={{ '--sidebar-w': `${width}px` } as React.CSSProperties}
      aria-label={t('sidebar.label')}
      aria-hidden={isOpen ? undefined : true}
    >
      <div className="sidebar-head">
        <span className="sidebar-title">FireMD</span>
        <button className="icon-btn" onClick={() => onNewNote()} aria-label={t('sidebar.newNote')} title={t('sidebar.newNote')}>
          <Plus size={15} />
        </button>
        <button className="icon-btn" onClick={onNewFolder} aria-label={t('sidebar.newFolder')} title={t('sidebar.newFolder')}>
          <FolderPlus size={15} />
        </button>
        <button className="icon-btn" onClick={onNewCanvas} aria-label={t('sidebar.newCanvas')} title={t('sidebar.newCanvas')}>
          <SquareDashed size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={isMobile ? onClose : onCollapse}
          aria-label={isMobile ? t('sidebar.closePanel') : t('sidebar.hidePanel')}
          title={isMobile ? t('sidebar.closePanel') : t('sidebar.hidePanel')}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {tagTree.length > 0 && (
        <div className="tag-panel" aria-label={t('sidebar.filterByTag')}>
          <div className="tag-panel-head">
            <button
              className="tag-panel-toggle"
              onClick={toggleTags}
              aria-expanded={tagsOpen}
              aria-controls="tag-tree"
              title={tagsOpen ? t('sidebar.hideTags') : t('sidebar.showTags')}
            >
              <ChevronRight size={11} className={`chev${tagsOpen ? ' open' : ''}`} />
              <span className="sidebar-section-label">{t('sidebar.tags')}</span>
              <span className="tag-panel-count">{tagTree.length}</span>
            </button>
            {selectedTags.length > 0 && (
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => selectedTags.forEach((tag) => onToggleTag(tag))}
                aria-label={t('sidebar.clearTagFilter')}
                title={t('sidebar.clearTagFilterShort')}
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
                  <div
                    className="folder-row"
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onFolderMenu(folder, { x: event.clientX, y: event.clientY })
                    }}
                  >
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
                      aria-label={t('sidebar.folderActions', { name: folder.name })}
                      onClick={(e) => onFolderMenu(folder, menuPos(e.currentTarget))}
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

      {/* Identity only: the name lives in the menu button's label, not as a
          second line competing with the tree. */}
      <div className="sidebar-foot">
        <div className="sidebar-identity" ref={identityRef}>
          {photoURL ? (
            <img className="avatar" src={photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar" aria-hidden="true">
              {uid ? <User size={11} /> : null}
            </span>
          )}
          <button
            className={`sync-dot-btn sync--${syncTone(status)}`}
            onClick={() => setStatusOpen((open) => !open)}
            aria-label={t('sidebar.syncStatus', {
              status: syncDetail(status)
                ? `${syncText(status)}. ${syncDetail(status)}`
                : syncText(status),
            })}
            aria-expanded={statusOpen}
            title={syncText(status)}
          >
            <span className="sync-dot" aria-hidden="true" />
          </button>
          {statusOpen && (
            <span className="sync-bubble">
              {syncText(status)}
              {syncDetail(status) && <small className="sync-detail">{syncDetail(status)}</small>}
            </span>
          )}
          {notice && (
            <button
              className="notice-btn"
              onClick={() => setOpenNotice(openNotice === notice ? null : notice)}
              aria-label={`Aviso: ${notice}`}
              aria-expanded={openNotice === notice}
              title={notice}
            >
              <Bell size={13} aria-hidden="true" />
            </button>
          )}
          {notice && openNotice === notice && (
            <div className="notice-bubble">
              <span style={{ flex: 1 }}>{notice}</span>
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => {
                  setOpenNotice(null)
                  onDismissNotice?.()
                }}
                aria-label="Descartar aviso"
                title="Descartar aviso"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-btn icon-btn--sm"
          onClick={onAccountClick}
          aria-label={userName ? t('sidebar.accountOf', { name: userName }) : t('sidebar.account')}
          title={userName ? t('sidebar.accountOf', { name: userName }) : t('sidebar.account')}
        >
          {/* The same gear the collapsed rail uses: this is the preferences
              entry, not a row's "more" menu. */}
          <Settings size={15} />
        </button>
      </div>

      {/* Splitter: mouse/touch drag on the edge, arrows/Home/End from the keyboard. */}
      {!isMobile && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('sidebar.resize')}
          aria-valuenow={width}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          tabIndex={0}
          title={t('sidebar.resizeHint')}
          onPointerDown={startResize}
          onKeyDown={onResizerKey}
          onDoubleClick={() => setWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      )}
    </aside>
  )
}
