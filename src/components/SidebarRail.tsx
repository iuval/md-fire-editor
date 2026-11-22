import { FolderPlus, PanelLeftOpen, Plus, Settings, SquareDashed } from 'lucide-react'

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
  return (
    <div
      className="sidebar-rail"
      role={collapsed ? 'group' : undefined}
      aria-label={collapsed ? 'Panel de notas' : undefined}
    >
      {collapsed && (
        <>
          <button
            className="icon-btn"
            onClick={onExpand}
            aria-label="Mostrar panel"
            title="Mostrar panel"
          >
            <PanelLeftOpen size={15} />
          </button>
          <div className="sidebar-rail-actions">
            <button className="icon-btn" onClick={onNewNote} aria-label="Nueva nota" title="Nueva nota">
              <Plus size={15} />
            </button>
            <button
              className="icon-btn"
              onClick={onNewFolder}
              aria-label="Nueva carpeta"
              title="Nueva carpeta"
            >
              <FolderPlus size={15} />
            </button>
            <button
              className="icon-btn"
              onClick={onNewCanvas}
              aria-label="Nuevo canvas"
              title="Nuevo canvas"
            >
              <SquareDashed size={15} />
            </button>
          </div>
          {/* A gear, not the footer's ⋯: this is the one menu in the app — the
              account and the appearance settings — and it should say so. */}
          <button
            className="icon-btn"
            onClick={onAccountClick}
            aria-label="Cuenta y ajustes"
            title="Cuenta y ajustes"
          >
            <Settings size={15} />
          </button>
        </>
      )}
    </div>
  )
}
