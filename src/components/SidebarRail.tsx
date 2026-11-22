import { FolderPlus, PanelLeftOpen, Plus, Settings, SquareDashed } from 'lucide-react'
import { useT } from '../i18n/index.ts'

interface SidebarRailProps {
  /** False while the panel is open: the panel's own margin covers the rail. */
  collapsed: boolean
  onExpand: () => void
  onNewNote: () => void
  onNewFolder: () => void
  onNewCanvas: () => void
  onAccountClick: () => void
}

/**
 * The panel's collapsed face: a 44px strip that keeps the create actions and
 * the account menu one click away without the tree. Expand sits at the top,
 * in the same corner as the panel's own collapse button, so the same spot
 * toggles the panel both ways.
 *
 * The strip stays mounted while the panel is open — the panel's negative
 * margin covers it — so collapsing animates one property and the shell's
 * width never jumps. Only the buttons come and go.
 */
export function SidebarRail({
  collapsed,
  onExpand,
  onNewNote,
  onNewFolder,
  onNewCanvas,
  onAccountClick,
}: SidebarRailProps) {
  const t = useT()
  return (
    <div
      className="sidebar-rail"
      role={collapsed ? 'group' : undefined}
      aria-label={collapsed ? t('rail.openNotes') : undefined}
    >
      {collapsed && (
        <>
          <button
            className="icon-btn"
            onClick={onExpand}
            aria-label={t('sidebar.showPanel')}
            title={t('sidebar.showPanel')}
          >
            <PanelLeftOpen size={15} />
          </button>
          <div className="sidebar-rail-actions">
            <button className="icon-btn" onClick={onNewNote} aria-label={t('sidebar.newNote')} title={t('sidebar.newNote')}>
              <Plus size={15} />
            </button>
            <button
              className="icon-btn"
              onClick={onNewFolder}
              aria-label={t('sidebar.newFolder')}
              title={t('sidebar.newFolder')}
            >
              <FolderPlus size={15} />
            </button>
            <button
              className="icon-btn"
              onClick={onNewCanvas}
              aria-label={t('sidebar.newCanvas')}
              title={t('sidebar.newCanvas')}
            >
              <SquareDashed size={15} />
            </button>
          </div>
          {/* A gear, not the footer's ⋯: this is the one menu in the app — the
              account and the appearance settings — and it should say so. */}
          <button
            className="icon-btn"
            onClick={onAccountClick}
            aria-label={t('rail.account')}
            title={t('rail.account')}
          >
            <Settings size={15} />
          </button>
        </>
      )}
    </div>
  )
}
