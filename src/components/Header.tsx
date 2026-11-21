import { Menu, Plus, Trash2, Cloud, CloudOff } from 'lucide-react'

interface HeaderProps {
  title: string
  onMenuClick: () => void
  onNewNote: () => void
  onDeleteNote: () => void
  isMobile: boolean
  syncStatus: 'synced' | 'syncing' | 'offline'
}

export function Header({ title, onMenuClick, onNewNote, onDeleteNote, isMobile, syncStatus }: HeaderProps) {
  return (
    <header
      style={{
        height: 52,
        borderBottom: '1px solid light-dark(var(--color-border), var(--color-border-dark))',
        background: 'light-dark(var(--color-surface), var(--color-surface-dark))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        {isMobile && (
          <button
            onClick={onMenuClick}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
            }}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        )}
        <input
          value={title}
          readOnly
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 15,
            fontWeight: 500,
            color: 'light-dark(var(--color-text), var(--color-text-dark))',
            outline: 'none',
            flex: 1,
            minWidth: 0,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            color:
              syncStatus === 'offline'
                ? '#ef4444'
                : syncStatus === 'syncing'
                  ? 'var(--color-accent)'
                  : '#22c55e',
            padding: '4px 8px',
            borderRadius: 4,
            background:
              syncStatus === 'offline'
                ? 'rgba(239,68,68,0.08)'
                : syncStatus === 'syncing'
                  ? 'rgba(194,94,0,0.08)'
                  : 'rgba(34,197,94,0.08)',
          }}
          title={syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Syncing...' : 'Offline'}
        >
          {syncStatus === 'offline' ? <CloudOff size={14} /> : <Cloud size={14} />}
          <span style={{ display: isMobile ? 'none' : 'inline' }}>
            {syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Syncing' : 'Offline'}
          </span>
        </div>

        <button
          onClick={onNewNote}
          style={{
            background: 'light-dark(var(--color-accent), var(--color-accent-dark))',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Plus size={14} />
          <span style={{ display: isMobile ? 'none' : 'inline' }}>New</span>
        </button>

        <button
          onClick={onDeleteNote}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ef4444',
          }}
          aria-label="Delete note"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </header>
  )
}
