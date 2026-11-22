/**
 * Visual-review gallery. Renders the real app components with fixture data and
 * no network, so every screen/state can be screenshotted deterministically.
 *
 *   /dev/gallery.html?state=app&theme=dark
 *
 * Never part of the production build (see vite.gallery.config.ts).
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowDownWideNarrow,
  Bot,
  Download,
  FileDown,
  FolderPlus,
  LogOut,
  Move,
  Pencil,
  Trash2,
  Upload,
  Link2,
} from 'lucide-react'
import '../src/index.css'
import { Sidebar } from '../src/components/Sidebar'
import { SidebarRail } from '../src/components/SidebarRail'
import { PaneBar } from '../src/components/PaneBar'
import { NotePane } from '../src/components/NotePane'
import { TabStrip } from '../src/components/TabStrip'
import { Workspace } from '../src/components/Workspace'
import {
  closePane,
  listPanes,
  moveTabToNewPane,
  moveTabToPane,
  openTab,
  singlePane,
  splitPane,
  type PaneLeaf,
} from '../src/lib/panes'
import type { PaneTabDrop } from '../src/components/NotePane'
import { Menu } from '../src/components/Menu'
import { NotePanels } from '../src/components/NotePanels'
import { CollaborativeEditor } from '../src/components/CollaborativeEditor'
import { EditorToolbar } from '../src/components/EditorToolbar'
import { ShareDialog } from '../src/components/ShareDialog'
import { SortDialog } from '../src/components/SortDialog'
import { MoveDialog } from '../src/components/MoveDialog'
import { InputDialog } from '../src/components/InputDialog'
import { RenameTagDialog } from '../src/components/RenameTagDialog'
import { UsageDialog } from '../src/components/UsageDialog'
import { UpgradeDialog } from '../src/components/UpgradeDialog'
import { AgentsDialog } from '../src/components/AgentsDialog'
import { Editor } from '@tiptap/core'
import * as Y from 'yjs'
import { FirestoreAwareness } from '../src/lib/collab/awareness'
import { buildEditorExtensions } from '../src/lib/editor/extensions'
import { buildTagTree } from '../src/lib/tags'
import { flattenFolders } from '../src/lib/folders'
import { parseProperties } from '../src/lib/properties'
import { splitFrontmatter } from '../src/lib/markdown'
import type { Note } from '../src/lib/notes'
import type { AwarenessUser } from '../src/lib/collab/awareness'
import type { ProviderStatus } from '../src/lib/collab/provider'
import { activeNote, connectedStatus, folders, notes, presence, savingStatus } from './fixtures'

const params = new URLSearchParams(window.location.search)
const state = params.get('state') ?? 'app'
const theme = params.get('theme')
const mobile = params.get('mobile') === '1'

if (theme === 'dark' || theme === 'light') {
  document.documentElement.style.colorScheme = theme
}

const UID = 'u-owner'
const USER = 'Iuval'

function tagTreeOf(list: Note[]) {
  return buildTagTree(list)
}

interface ShellProps {
  notes: Note[]
  activeId: string | null
  expanded: Set<string>
  status: ProviderStatus
  presenceUsers: AwarenessUser[]
  selectedTags?: string[]
  loading?: boolean
  children?: React.ReactNode
  /** Replaces the single document with the tab/split workspace. */
  paneContent?: React.ReactNode
  /** Tabs rendered inside the top bar (single-pane layout). */
  barTabs?: React.ReactNode
}

function Shell({
  notes: list,
  activeId,
  expanded,
  status,
  presenceUsers,
  selectedTags = [],
  loading = false,
  children,
  paneContent,
  barTabs,
}: ShellProps) {
  // `sidebar=closed` lets the review see the phone layout without the drawer on top.
  const [sidebarOpen] = useState(mobile && params.get('sidebar') !== 'closed')
  // Mirrors App.tsx so the collapse button can be reviewed, not just described.
  const [collapsed, setCollapsed] = useState(params.get('collapsed') === '1')
  const note = list.find((n) => n.id === activeId) ?? null
  const body = note ? splitFrontmatter(note.markdown).body : ''

  return (
    <div className="shell">
      {!mobile && (
        <SidebarRail
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
          onNewNote={() => {}}
          onNewFolder={() => {}}
          onNewCanvas={() => {}}
          onAccountClick={() => {}}
        />
      )}
      <Sidebar
        notes={list}
        folders={folders}
        activeId={activeId}
        onSelect={() => {}}
        onNewNote={() => {}}
        onNewFolder={() => {}}
        onNewCanvas={() => {}}
        rootSort="updated"
        onFolderMenu={() => {}}
        expanded={expanded}
        onToggleFolder={() => {}}
        onClose={() => {}}
        onCollapse={() => setCollapsed((v) => !v)}
        isMobile={mobile}
        isOpen={mobile ? sidebarOpen : !collapsed}
        status={status}
        loading={loading}
        tagTree={tagTreeOf(list)}
        selectedTags={selectedTags}
        onToggleTag={() => {}}
        uid={UID}
        userName={USER}
        photoURL={null}
        onAccountClick={() => {}}
      />

      <main className="pane">
        <PaneBar
          presence={presenceUsers}
          isMobile={mobile}
          onToggleSidebar={() => setCollapsed((v) => !v)}
          tabs={barTabs}
        />

        {paneContent ?? (
        <div className="scroll">
          {!note && (
            <div className="empty" style={{ minHeight: '60vh' }}>
              <p style={{ margin: 0 }}>No hay ninguna nota abierta</p>
              <button className="btn ghost">Crear nota</button>
            </div>
          )}

          {note && (
            <div className="doc">
              <input
                className="inline-title"
                value={note.title}
                readOnly
                placeholder="Sin título"
                aria-label="Título de la nota"
              />
              <NotePanels
                tags={note.tags}
                properties={parseProperties(note.markdown)}
                editable
                onPropertyChange={() => {}}
              />
              <CollaborativeEditor
                key={note.id}
                note={note}
                body={body}
                uid={UID}
                userName={USER}
                editable
                onMarkdownChange={() => {}}
                onPresence={() => {}}
                onStatus={() => {}}
                isMobile={mobile}
              />
            </div>
          )}
        </div>
        )}
      </main>
      {children}
    </div>
  )
}

/**
 * The strip that lives in the top bar, with its own tabs: dragging one along it
 * is the same gesture as dragging it across the workspace, so the gallery has to
 * carry the layout even when there is only one pane.
 */
function InlineStripProbe() {
  const [pane, setPane] = useState<PaneLeaf>(() => {
    let next = openTab(singlePane('p1', notes[0].id, 't1'), 'p1', notes[1].id, 't2')
    next = openTab(next, 'p1', notes[2].id, 't3')
    return next.kind === 'pane' ? { ...next, activeTabId: 't2' } : singlePane('p1')
  })
  const titles = new Map(notes.map((note) => [note.id, note.title]))
  return (
    <TabStrip
      compact
      paneId={pane.id}
      onDropTab={(source, index) =>
        setPane((current) => {
          const next = moveTabToPane(current, source, current.id, index)
          return next.kind === 'pane' ? next : current
        })
      }
      tabs={pane.tabs.map((tab) => ({ id: tab.id, title: titles.get(tab.noteId) ?? '' }))}
      activeTabId={pane.activeTabId}
      onActivate={() => {}}
      onClose={() => {}}
      onNewNote={() => {}}
      onSplitRight={() => {}}
      onSplitDown={() => {}}
    />
  )
}

/** Two panes with tabs (or one pane whose tabs live in the top bar). */
function TabsProbe({ single = false }: { single?: boolean }) {
  const [focused, setFocused] = useState('p1')
  const [tree, setTree] = useState(() => {
    if (single) {
      let pane = openTab(singlePane('p1', notes[0].id, 't1'), 'p1', notes[1].id, 't2')
      pane = openTab(pane, 'p1', notes[2].id, 't3')
      return { ...pane, activeTabId: 't2' }
    }
    const empty = params.get('empty') === '1'
    const second: PaneLeaf = {
      kind: 'pane',
      id: 'p2',
      tabs: empty ? [] : [{ id: 't2', noteId: params.get('same') === '1' ? activeNote.id : notes[1].id }],
      activeTabId: empty ? null : 't2',
    }
    return splitPane(
      singlePane('p1', activeNote.id, 't1'),
      'p1',
      mobile ? 'column' : 'row',
      second,
      's1'
    )
  })
  const titles = new Map(notes.map((note) => [note.id, note.title]))

  const closable = listPanes(tree).length > 1

  /**
   * The same drop the app does: the gallery has no router, so the layout state
   * is all that changes. Used to review the drag and its highlighted landing
   * area without signing in.
   */
  const tabDrop = (paneId: string): PaneTabDrop => ({
    onDropAt: (source, index) => {
      setTree((current) => moveTabToPane(current, source, paneId, index))
      setFocused(paneId)
    },
    onDropZone: (source, zone) => {
      const newPaneId = `pane-drop-${source.tabId}`
      setTree((current) =>
        zone === 'center'
          ? moveTabToPane(current, source, paneId)
          : moveTabToNewPane(current, source, paneId, zone, {
              paneId: newPaneId,
              splitId: `split-drop-${source.tabId}`,
            })
      )
      setFocused(zone === 'center' ? paneId : newPaneId)
    },
    canSplit: true,
  })

  return (
    <Workspace
      tree={tree}
      focusedPaneId={focused}
      isMobile={mobile}
      onFocusPane={setFocused}
      onRatio={() => {}}
      renderPane={(pane) => {
        const current = pane.tabs.find((tab) => tab.id === pane.activeTabId)
        return (
          <NotePane
            pane={pane}
            titles={titles}
            note={notes.find((note) => note.id === current?.noteId) ?? null}
            noteError={null}
            focused={pane.id === focused}
            uid={UID}
            userName={USER}
            folders={folders}
            isMobile={mobile}
            onFocus={() => setFocused(pane.id)}
            onActivateTab={() => {}}
            onCloseTab={() => {}}
            onNewNote={() => {}}
            tabDrop={tabDrop(pane.id)}
            onClosePane={closable ? () => setTree((current) => closePane(current, pane.id)) : undefined}
            hideTabs={single}
            onImport={() => {}}
            emptyWorkspace={false}
            onSplitRight={mobile ? undefined : () => {}}
            onSplitDown={mobile ? undefined : () => {}}
            onTagClick={() => {}}
            onRenameTag={() => {}}
            onPresence={() => {}}
            onStatus={() => {}}
          />
        )
      }}
    />
  )
}

/**
 * The real toolbar needs a focused editor, and this browser cannot dispatch
 * focus events (document.hasFocus() is false in automation). The probe mounts
 * the same component against a real editor so the bar can be reviewed.
 */
function ToolbarProbe() {
  const editor = useState(() => {
    const doc = new Y.Doc()
    const user = { name: 'Ana', color: '#a84e00' }
    const awareness = new FirestoreAwareness('probe', 'u-ana', user, doc, null)
    const instance = new Editor({
      element: document.createElement('div'),
      extensions: buildEditorExtensions({ doc, awareness, user }),
      content: 'Texto',
    })
    instance.commands.toggleBold()
    return instance
  })[0]
  return <EditorToolbar editor={editor} visible />
}

const allExpanded = new Set(folders.map((f) => f.id))

function App() {
  switch (state) {
    case 'login':
      // Mirrors App.tsx: keep them in sync or the review is of a different app.
      return (
        <div className="auth">
          <div className="auth-panel">
            <span className="auth-wordmark">
              <img className="auth-mark" src="/favicon.svg" alt="" width={20} height={20} />
              FireMD
            </span>
            <h1 className="auth-title">Tus notas en Markdown, en carpetas, compartidas.</h1>
            <p className="auth-sub">
              Edición en tiempo real sobre tu vault de Obsidian. Lo que escribís sigue siendo un{' '}
              <code>.md</code>.
            </p>
            <button className="btn auth-btn">Entrar con Google</button>
          </div>
        </div>
      )

    case 'empty-workspace':
      return (
        <Shell
          notes={[]}
          activeId={null}
          expanded={new Set()}
          status={connectedStatus}
          presenceUsers={[]}
          loading={false}
        />
      )

    case 'no-note':
      return (
        <Shell
          notes={notes}
          activeId={null}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        />
      )

    case 'loading':
      return (
        <Shell
          notes={[]}
          activeId={null}
          expanded={new Set()}
          status={{ connected: false, pendingWrites: 0, error: null }}
          presenceUsers={[]}
          loading
        />
      )

    case 'saving':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={savingStatus}
          presenceUsers={presence as AwarenessUser[]}
        />
      )

    case 'error':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={{ connected: false, pendingWrites: 0, error: 'Sin permisos' }}
          presenceUsers={[]}
        />
      )

    case 'filtered':
      return (
        <Shell
          notes={notes.filter((n) => n.tags.includes('arquitectura'))}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={presence as AwarenessUser[]}
          selectedTags={['arquitectura']}
        />
      )

    case 'toolbar':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <ToolbarProbe />
        </Shell>
      )

    case 'tabs':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={presence as AwarenessUser[]}
          paneContent={<TabsProbe />}
        />
      )

    case 'tabs-inline':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={presence as AwarenessUser[]}
          paneContent={<TabsProbe single />}
          barTabs={
            <InlineStripProbe />
          }
        />
      )

    case 'collapsed':
      return <CollapsedShell />

    case 'share-note':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={presence as AwarenessUser[]}
        >
          <ShareDialog
            target={{
              kind: 'note',
              id: activeNote.id,
              name: activeNote.title,
              acl: {
                memberIds: activeNote.memberIds,
                roles: activeNote.roles,
                access: activeNote.access,
              },
              ownerId: activeNote.ownerId,
              inheritedFrom: { id: 'f-specs', name: 'Producto/Especificaciones' },
            }}
            currentUid={UID}
            onClose={() => {}}
            onChangeAccess={async () => {}}
            onAddMember={async () => {}}
            onSetRole={async () => {}}
            onRemoveMember={async () => {}}
            onOpenFolder={() => {}}
          />
        </Shell>
      )

    case 'sort':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <SortDialog target="Producto/Especificaciones" current="updated" onChoose={() => {}} onClose={() => {}} />
        </Shell>
      )

    case 'move':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <MoveDialog
            noteTitle={activeNote.title}
            folders={flattenFolders(folders).map((node) => ({
              ...node.folder,
              name: `${'\u00a0\u00a0'.repeat(node.depth)}${node.folder.name}`,
            }))}
            currentFolderId="f-specs"
            onMove={() => {}}
            onClose={() => {}}
          />
        </Shell>
      )

    case 'input':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <InputDialog title="Nueva carpeta" label="Nombre" confirmLabel="Crear" onConfirm={() => {}} onClose={() => {}} />
        </Shell>
      )

    case 'rename-tag':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <RenameTagDialog
            current="arquitectura"
            knownTags={['arquitectura', 'colaboracion', 'permisos', 'producto']}
            onRename={() => {}}
            onClose={() => {}}
          />
        </Shell>
      )

    case 'usage':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <UsageDialog
            usage={{
              month: '2025-11',
              writes: 12840,
              reads: 39210,
              bytesWritten: 5_400_000,
              bytesRead: 22_800_000,
              storageBytes: 1_900_000,
            }}
            credits={{ balanceUsd: 4.2, thresholdUsd: 2, topUpUsd: 10, autoTopUp: true }}
            paid
            notes={notes.length}
            folders={folders.length}
            onClose={() => {}}
          />
        </Shell>
      )

    case 'upgrade':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <UpgradeDialog onClose={() => {}} onExport={() => {}} />
        </Shell>
      )

    case 'agents':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <AgentsDialog folders={folders} onLink={async () => {}} onClose={() => {}} />
        </Shell>
      )

    case 'menu-note':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <Menu
            onClose={() => {}}
            items={[
              { label: 'Compartir…', icon: <Link2 size={14} />, onSelect: () => {} },
              { label: 'Mover a carpeta…', icon: <Move size={14} />, onSelect: () => {} },
              { label: 'Renombrar…', icon: <Pencil size={14} />, onSelect: () => {} },
              { label: 'Exportar .md', icon: <FileDown size={14} />, separatorBefore: true, onSelect: () => {} },
              { label: 'Borrar nota', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => {} },
            ]}
          />
        </Shell>
      )

    case 'menu-account':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <Menu
            anchor="bottom-left"
            onClose={() => {}}
            items={[
              { label: 'Exportar vault (.zip)', icon: <Download size={14} />, onSelect: () => {} },
              { label: 'Uso y facturación…', icon: <Activity size={14} />, separatorBefore: true, onSelect: () => {} },
              { label: 'Importar vault (.zip o .md)…', icon: <Upload size={14} />, onSelect: () => {} },
              { label: 'Agentes de IA…', icon: <Bot size={14} />, separatorBefore: true, onSelect: () => {} },
              { label: 'Cerrar sesión', icon: <LogOut size={14} />, separatorBefore: true, onSelect: () => {} },
            ]}
          />
        </Shell>
      )

    case 'menu-folder':
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={[]}
        >
          <Menu
            anchor="pointer"
            pos={{ x: 40, y: 180 }}
            onClose={() => {}}
            items={[
              { label: 'Nueva nota', icon: <FolderPlus size={14} />, onSelect: () => {} },
              { label: 'Nueva subcarpeta', icon: <FolderPlus size={14} />, onSelect: () => {} },
              { label: 'Orden: Fecha de modificación…', icon: <ArrowDownWideNarrow size={14} />, separatorBefore: true, onSelect: () => {} },
              { label: 'Compartir…', icon: <Link2 size={14} />, separatorBefore: true, onSelect: () => {} },
              { label: 'Borrar carpeta', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => {} },
            ]}
          />
        </Shell>
      )

    case 'app':
    default:
      return (
        <Shell
          notes={notes}
          activeId={activeNote.id}
          expanded={allExpanded}
          status={connectedStatus}
          presenceUsers={presence as AwarenessUser[]}
        />
      )
  }
}

/** Sidebar collapsed: the rail carries the create actions and the expand button. */
function CollapsedShell() {
  const note = activeNote
  const body = splitFrontmatter(note.markdown).body
  return (
    <div className="shell">
      <SidebarRail
        collapsed
        onExpand={() => {}}
        onNewNote={() => {}}
        onNewFolder={() => {}}
        onNewCanvas={() => {}}
        onAccountClick={() => {}}
      />
      <Sidebar
        notes={notes}
        folders={folders}
        activeId={activeNote.id}
        onSelect={() => {}}
        onNewNote={() => {}}
        onNewFolder={() => {}}
        onNewCanvas={() => {}}
        rootSort="updated"
        onFolderMenu={() => {}}
        expanded={allExpanded}
        onToggleFolder={() => {}}
        onClose={() => {}}
        onCollapse={() => {}}
        isMobile={false}
        isOpen={false}
        status={connectedStatus}
        loading={false}
        tagTree={tagTreeOf(notes)}
        selectedTags={[]}
        onToggleTag={() => {}}
        uid={UID}
        userName={USER}
        photoURL={null}
        onAccountClick={() => {}}
      />
      <main className="pane">
        <PaneBar presence={[]} isMobile={false} onToggleSidebar={() => {}} />
        <div className="scroll">
          <div className="doc">
            <input className="inline-title" value={note.title} readOnly aria-label="Título de la nota" />
            <NotePanels tags={note.tags} properties={[]} editable onPropertyChange={() => {}} />
            <CollaborativeEditor
              note={note}
              body={body}
              uid={UID}
              userName={USER}
              editable
              onMarkdownChange={() => {}}
              onPresence={() => {}}
              onStatus={() => {}}
              isMobile={mobile}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
