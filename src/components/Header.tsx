import { Menu, Plus, Trash2, Cloud, CloudOff, LogIn, LogOut, User } from 'lucide-react'

interface HeaderProps {
  title: string
  onMenuClick: () => void
  onNewNote: () => void
  onDeleteNote: () => void
  isMobile: boolean
  syncStatus: 'synced' | 'syncing' | 'offline'
  user: { displayName?: string | null; email?: string | null; photoURL?: string | null; uid: string } | null
  onSignIn: () => void
  onSignOut: () => void
  isLocalMode: boolean
}

export function Header({
  title,
  onMenuClick,
  onNewNote,
  onDeleteNote,
  isMobile,
  syncStatus,
  user,
  onSignIn,
  onSignOut,
  isLocalMode,
}: HeaderProps) {
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
        flexShrink: 0,
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
        {isLocalMode && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(239,68,68,0.08)',
              color: '#ef4444',
            }}
          >
            Local
          </span>
        )}

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

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'light-dark(var(--color-accent), var(--color-accent-dark))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <User size={14} />
                </div>
              )}
              {!isMobile && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.displayName || user.email || 'User'}
                </span>
              )}
            </div>
            <button
              onClick={onSignOut}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                color: 'light-dark(var(--color-muted), var(--color-muted-dark))',
              }}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={onSignIn}
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
            <LogIn size={14} />
            <span style={{ display: isMobile ? 'none' : 'inline' }}>Sign in</span>
          </button>
        )}

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
