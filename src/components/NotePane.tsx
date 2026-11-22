import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CollaborativeEditor } from './CollaborativeEditor'
import { NotePanels, type PropertyChange } from './NotePanels'
import { TabStrip } from './TabStrip'
import {
  noteCanEdit,
  saveNoteContent,
  type Folder,
  type Note,
} from '../lib/notes'
import { folderPath, sharedFolderOf } from '../lib/folders'
import { joinFrontmatter, sameMarkdown, splitFrontmatter } from '../lib/markdown'
import { extractTags } from '../lib/tags'
import { parseProperties, setProperty } from '../lib/properties'
import type { AwarenessUser } from '../lib/collab/awareness'
import type { ProviderStatus, SyncStats } from '../lib/collab/provider'
import type { PaneLeaf } from '../lib/panes'

interface NoteDocumentProps {
  note: Note
  uid: string
  userName: string
  folders: Folder[]
  isMobile: boolean
  onTagClick: (tag: string) => void
  onRenameTag: () => void
  onPresence: (users: AwarenessUser[]) => void
  onStatus: (status: ProviderStatus) => void
  onStats?: (stats: SyncStats) => void
}

/**
 * One note: title, metadata and the collaborative editor, with its own debounced
 * save timers. It is keyed by note id, so switching tabs can never carry an
 * unsaved edit (or a stale frontmatter) into the next document.
 */
function NoteDocument({
  note,
  uid,
  userName,
  folders,
  isMobile,
  onTagClick,
  onRenameTag,
  onPresence,
  onStatus,
  onStats,
}: NoteDocumentProps) {
  const [title, setTitle] = useState(note.title)
  const titleFocused = useRef(false)
  const frontmatterRef = useRef('')
  const markdownRef = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const editable = noteCanEdit(note, folders, uid)
  const sharedFolder = sharedFolderOf(note, folders)

  useEffect(() => {
    // Follow external renames (agent, another device) unless the user is typing.
    if (!titleFocused.current) setTitle(note.title)
  }, [note.id, note.title])

  // The editor never sees the frontmatter: it would turn `---` into a rule and
  // flatten `key: value` into a paragraph, destroying properties and tags.
  const body = useMemo(() => splitFrontmatter(note.markdown ?? '').body, [note.markdown])

  useEffect(() => {
    const parts = splitFrontmatter(note.markdown ?? '')
    frontmatterRef.current = parts.frontmatter
    markdownRef.current = note.markdown ?? ''
  }, [note.markdown])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (titleTimer.current) clearTimeout(titleTimer.current)
    }
  }, [])

  const persist = useCallback(
    (patch: { title?: string; markdown?: string; tags?: string[] }) => {
      void saveNoteContent(note.id, { ...patch, version: note.version + 1 }).catch(() => undefined)
    },
    [note.id, note.version]
  )

  const handleMarkdownChange = useCallback(
    (nextBody: string) => {
      const full = joinFrontmatter(frontmatterRef.current, nextBody)
      // Nothing actually changed (echo of a seed or of a remote apply): do not
      // touch the document, or opening a note reorders it.
      if (sameMarkdown(full, markdownRef.current)) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        persist({ markdown: full, tags: extractTags(full) })
      }, 1200)
    },
    [persist]
  )

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitle(next)
      if (!editable) return
      if (titleTimer.current) clearTimeout(titleTimer.current)
      titleTimer.current = setTimeout(() => persist({ title: next.trim() || 'Sin título' }), 600)
    },
    [editable, persist]
  )

  const handlePropertyChange = useCallback(
    async (change: PropertyChange) => {
      const next =
        change.value === null
          ? setProperty(note.markdown ?? '', { key: change.key, value: null })
          : setProperty(note.markdown ?? '', {
              key: change.key,
              type: change.type ?? 'text',
              value: change.value,
            })
      frontmatterRef.current = splitFrontmatter(next).frontmatter
      await saveNoteContent(note.id, {
        markdown: next,
        tags: extractTags(next),
        version: note.version + 1,
      })
    },
    [note.id, note.markdown, note.version]
  )

  return (
    <div className="doc">
      <input
        className="inline-title"
        value={title}
        onChange={(event) => handleTitleChange(event.target.value)}
        readOnly={!editable}
        maxLength={300}
        placeholder="Sin título"
        aria-label="Título de la nota"
        spellCheck={false}
        onFocus={() => {
          titleFocused.current = true
        }}
        onBlur={() => {
          titleFocused.current = false
        }}
      />
      <NotePanels
        tags={note.tags}
        properties={parseProperties(note.markdown ?? '')}
        editable={editable}
        onTagClick={onTagClick}
        onRenameTag={onRenameTag}
        onPropertyChange={(change) => void handlePropertyChange(change)}
      />
      {sharedFolder && (
        <p className="readonly-note">
          En «{folderPath(sharedFolder.id, foldersById)}» · permisos heredados de la carpeta
        </p>
      )}
      <CollaborativeEditor
        key={note.id}
        note={note}
        body={body}
        uid={uid}
        userName={userName}
        editable={editable}
        onMarkdownChange={handleMarkdownChange}
        onPresence={onPresence}
        onStatus={onStatus}
        onStats={onStats}
        isMobile={isMobile}
      />
    </div>
  )
}

interface NotePaneProps {
  pane: PaneLeaf
  /** Titles come from the workspace list: inactive tabs cost no subscription. */
  titles: Map<string, string>
  note: Note | null
  noteError: string | null
  focused: boolean
  uid: string
  userName: string
  folders: Folder[]
  isMobile: boolean
  onFocus: () => void
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewNote: () => void
  /** Absent when this is the only pane. */
  onClosePane?: () => void
  /** Its tabs are rendered by the top bar (single-pane layout). */
  hideTabs?: boolean
  /** The note document is still being written: its tab already exists. */
  creating?: boolean
  onImport: () => void
  /** No notes at all yet: the empty pane carries the onboarding actions. */
  emptyWorkspace: boolean
  /** Splits are plain buttons in the strip; absent on a phone. */
  onSplitRight?: () => void
  onSplitDown?: () => void
  splitLimitLabel?: string
  onTagClick: (tag: string) => void
  onRenameTag: () => void
  onPresence: (users: AwarenessUser[]) => void
  onStatus: (status: ProviderStatus) => void
  onStats?: (stats: SyncStats) => void
}

const ignorePresence = () => undefined
const ignoreStatus = () => undefined
const ignoreStats = () => undefined

export function NotePane({
  pane,
  titles,
  note,
  noteError,
  focused,
  uid,
  userName,
  folders,
  isMobile,
  onFocus,
  onActivateTab,
  onCloseTab,
  onNewNote,
  onClosePane,
  hideTabs = false,
  creating = false,
  onImport,
  emptyWorkspace,
  onSplitRight,
  onSplitDown,
  splitLimitLabel,
  onTagClick,
  onRenameTag,
  onPresence,
  onStatus,
  onStats,
}: NotePaneProps) {
  const activeTabId = pane.activeTabId
  const hasTab = pane.tabs.some((tab) => tab.id === activeTabId)

  return (
    <section
      className={`workspace-pane${focused ? ' focused' : ''}`}
      aria-label="Panel de nota"
      onPointerDownCapture={onFocus}
    >
      {!hideTabs && (
        <TabStrip
          tabs={pane.tabs.map((tab) => ({ id: tab.id, title: titles.get(tab.noteId) ?? '' }))}
          activeTabId={activeTabId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onNewNote={onNewNote}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          splitLimitLabel={splitLimitLabel}
          onClosePane={onClosePane}
        />
      )}

      <div className="scroll">
        {noteError && (
          <p className="hint tone-danger" style={{ padding: '16px 24px' }}>
            {noteError}
          </p>
        )}

        {!hasTab && (
          <div className="empty" style={{ minHeight: '50vh' }}>
            <p className="empty-title">
              {emptyWorkspace ? 'Todavía no hay notas' : 'Panel vacío'}
            </p>
            <p className="hint" style={{ maxWidth: 340, textAlign: 'center' }}>
              {emptyWorkspace
                ? 'Creá una nota nueva, o importá un vault de Obsidian (.zip o .md) y seguí donde estabas.'
                : 'Elegí una nota en el panel de la izquierda y se abre acá. En la barra de pestañas podés dividir este panel a la derecha o abajo.'}
            </p>
            <div className="row">
              <button className="btn" onClick={onNewNote}>
                Crear nota
              </button>
              {emptyWorkspace && (
                <button className="btn ghost" onClick={onImport}>
                  Importar vault
                </button>
              )}
            </div>
          </div>
        )}

        {hasTab && !note && !noteError && (
          <p className="hint" style={{ padding: '16px 24px' }}>
            {creating ? 'Creando la nota…' : 'Cargando…'}
          </p>
        )}

        {/* Only the focused pane owns the sync indicator in the top bar. */}
        {hasTab && note && (
          <NoteDocument
            key={note.id}
            note={note}
            uid={uid}
            userName={userName}
            folders={folders}
            isMobile={isMobile}
            onTagClick={onTagClick}
            onRenameTag={onRenameTag}
            onPresence={focused ? onPresence : ignorePresence}
            onStatus={focused ? onStatus : ignoreStatus}
            onStats={focused ? onStats : ignoreStats}
          />
        )}
      </div>
    </section>
  )
}
