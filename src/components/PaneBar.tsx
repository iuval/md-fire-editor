import { MoreHorizontal, PanelLeftOpen, Menu } from 'lucide-react'
import type { AwarenessUser } from '../lib/collab/awareness'
import type { ProviderStatus } from '../lib/collab/provider'

interface PaneBarProps {
  title: string
  status: ProviderStatus
  presence: AwarenessUser[]
  sidebarCollapsed: boolean
  isMobile: boolean
  onToggleSidebar: () => void
  onMenu: () => void
  menuOpen: boolean
}

function statusColor(status: ProviderStatus) {
  if (status.error) return '#e05252'
  if (status.pendingWrites > 0 || !status.connected) return '#d9a13b'
  return '#3fa65c'
}

function statusText(status: ProviderStatus) {
  if (status.error) return 'Sin conexión'
  if (status.pendingWrites > 0) return 'Guardando'
  if (!status.connected) return 'Conectando'
  return 'Sincronizado'
}

export function PaneBar({
  title,
  status,
  presence,
  sidebarCollapsed,
  isMobile,
  onToggleSidebar,
  onMenu,
  menuOpen,
}: PaneBarProps) {
  return (
    <div className="pane-head">
      {(isMobile || sidebarCollapsed) && (
        <button
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-label={isMobile ? 'Abrir notas' : 'Mostrar panel'}
          title={isMobile ? 'Abrir notas' : 'Mostrar panel'}
        >
          {isMobile ? <Menu size={16} /> : <PanelLeftOpen size={15} />}
        </button>
      )}

      <span className="pane-title">{title || 'Sin título'}</span>

      {presence.length > 0 && (
        <span style={{ display: 'flex', alignItems: 'center' }} aria-label="Editando ahora">
          {presence.slice(0, 3).map((p, i) => (
            <span
              key={p.uid}
              title={p.name}
              className="avatar"
              style={{
                background: p.color,
                color: '#fff',
                marginLeft: i === 0 ? 0 : -5,
                border: '1px solid light-dark(var(--color-bg), var(--color-bg-dark))',
                boxShadow: 'none',
              }}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
      )}

      <span
        className="status-dot"
        style={{ background: statusColor(status) }}
        role="img"
        title={statusText(status)}
        aria-label={statusText(status)}
      />

      <button
        className="icon-btn"
        onClick={onMenu}
        aria-label="Más acciones"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Más acciones"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  )
}
