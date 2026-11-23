import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CollaborativeEditor } from './CollaborativeEditor'
import { CanvasEditor } from './CanvasEditor'
import { NotePanels, type PropertyChange } from './NotePanels'
import { TabStrip } from './TabStrip'
import { PaneDropTarget } from './PaneDropTarget'
import type { DropZone, TabDragSource } from '../lib/tabDrag'
import {
  mergeDeferred,
  noteCanEdit,
  saveNoteContent,
  MAX_MARKDOWN_BYTES,
  type DeferredWrite,
  type Folder,
  type Note,
} from '../lib/notes'
import { MAX_CANVAS_CHARS, canvasTagsOf } from '../lib/canvas/model'
import { isLocalMode } from '../lib/localStore'
import type { CanvasFileRef } from '../lib/canvas/files'
import { useT } from '../i18n/index.ts'
import { DocCrumbs } from './DocCrumbs'
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
  /** The note document is still being written: edits wait for it. */
  creating: boolean
  /** Every note as an Obsidian vault path: `file` cards resolve against it. */
  canvasFiles: CanvasFileRef[]
  onOpenNote: (noteId: string) => void
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
  creating,
  canvasFiles,
  onOpenNote,
  onTagClick,
  onRenameTag,
  onPresence,
  onStatus,
  onStats,
}: NoteDocumentProps) {
  const t = useT()
  const [title, setTitle] = useState(note.title)
  const titleFocused = useRef(false)
  const frontmatterRef = useRef('')
  const markdownRef = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Edits made between opening the tab and the note document landing. The
   * document does not exist yet, so writing would be rejected; they are merged
   * here and flushed the moment it exists.
   */
  const deferred = useRef<DeferredWrite | null>(null)
  /**
   * Read at write time, not captured: a debounce armed before the document
   * existed must still be able to write once it does (a closure would defer the
   * edit forever and lose it).
   */
  const creatingRef = useRef(creating)

  const editable = noteCanEdit(note, folders, uid)
  const isCanvas = note.kind === 'canvas'
  /**
   * Read once: `creating` turns false the moment the document lands, and the
   * caret still has to reach a field that mounted while it was true.
   */
  const [justCreated] = useState(creating)
  const titleRef = useRef<HTMLInputElement>(null)
  /** Bumped on Enter in the title: the body takes the caret from there. */
  const [bodyFocus, setBodyFocus] = useState(0)

  // A new note is created to be named: the caret starts in the title, so the
  // first keystroke after the + button is already the note's name.
  useEffect(() => {
    if (!justCreated || !editable) return
    titleRef.current?.focus()
  }, [justCreated, editable])

  useEffect(() => {
    // Follow external renames (agent, another device) unless the user is typing.
    if (!titleFocused.current) setTitle(note.title)
  }, [note.id, note.title])

  // The editor never sees the frontmatter: it would turn `---` into a rule and
  // flatten `key: value` into a paragraph, destroying properties and tags. A
  // canvas body is JSON, so it travels whole.
  const body = useMemo(
    () => (isCanvas ? (note.markdown ?? '') : splitFrontmatter(note.markdown ?? '').body),
    [isCanvas, note.markdown]
  )

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
    (patch: { title?: string; markdown?: string; tags?: string[] }, maxChars = MAX_MARKDOWN_BYTES) => {
      if (creatingRef.current) {
        deferred.current = mergeDeferred(deferred.current, patch, maxChars)
        return
      }
      void saveNoteContent(note.id, {
        ...patch,
        version: note.version + 1,
        maxChars,
      }).catch(() => undefined)
    },
    [note.id, note.version]
  )

  // The document exists now: send whatever was typed while it did not. The ref
  // is updated first, so a debounce that fires after this effect writes directly
  // instead of deferring again.
  useEffect(() => {
    creatingRef.current = creating
    if (creating) return
    const wait = deferred.current
    if (!wait) return
    deferred.current = null
    void saveNoteContent(note.id, {
      ...wait.patch,
      version: note.version + 1,
      maxChars: wait.maxChars,
    }).catch(() => undefined)
  }, [creating, note.id, note.version])

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

  /**
   * A canvas writes the same body field as markdown, with its own size limit:
   * `bodyDocument` slices, and a sliced canvas is an unparseable file.
   */
  const handleCanvasChange = useCallback(
    (json: string) => {
      if (sameMarkdown(json, markdownRef.current)) return
      markdownRef.current = json
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        persist({ markdown: json, tags: canvasTagsOf(json) }, MAX_CANVAS_CHARS)
      }, 1200)
    },
    [persist]
  )

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitle(next)
      if (!editable) return
      if (titleTimer.current) clearTimeout(titleTimer.current)
      // An emptied title is a nameless note, not a note called "Untitled": the
      // field keeps `Untitled` only as its placeholder.
      titleTimer.current = setTimeout(() => persist({ title: next.trim() }), 600)
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

  const header = (
    <div className="doc-header">
      <DocCrumbs folderId={note.folderId} folders={folders} />
      <input
        ref={titleRef}
        className="inline-title"
        value={title}
        onChange={(event) => handleTitleChange(event.target.value)}
        readOnly={!editable}
        maxLength={300}
        placeholder={t('note.titlePlaceholder')}
        aria-label={t('note.titleLabel')}
        spellCheck={false}
        onKeyDown={(event) => {
          // Enter on the name writes the note: same hand-off as Obsidian, where
          // the title is the first line of the document.
          if (event.key !== 'Enter') return
          event.preventDefault()
          setBodyFocus((count) => count + 1)
        }}
        onFocus={() => {
          titleFocused.current = true
        }}
        onBlur={() => {
          titleFocused.current = false
        }}
      />
      <NotePanels
        tags={note.tags}
        // A canvas has no frontmatter: properties would be a lie, and its tags
        // are derived from the cards, not edited as a list.
        properties={isCanvas ? [] : parseProperties(note.markdown ?? '')}
        editable={editable && !isCanvas}
        onTagClick={onTagClick}
        onRenameTag={onRenameTag}
        onPropertyChange={(change) => void handlePropertyChange(change)}
      />
    </div>
  )

  if (isCanvas) {
    // A canvas owns the pane: no reading column, no page scroll, the surface
    // fills what is left. The title stays as the slim bar above it.
    return (
      <div className="doc doc--canvas">
        {header}
        <CanvasEditor
          key={note.id}
          note={note}
          body={body}
          uid={uid}
          userName={userName}
          editable={editable}
          isMobile={isMobile}
          files={canvasFiles}
          onOpenNote={onOpenNote}
          onJsonChange={handleCanvasChange}
          onPresence={onPresence}
          onStatus={onStatus}
          onStats={onStats}
        />
      </div>
    )
  }

  return (
    <div className="doc">
      {header}
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
        local={isLocalMode()}
        focusSignal={bodyFocus}
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
  canvasFiles: CanvasFileRef[]
  onOpenNote: (noteId: string) => void
  onFocus: () => void
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewNote: () => void
  /** Renames a note from a double click on its tab; absent when it cannot be written. */
  onRenameNote?: (noteId: string, title: string) => void
  /** Absent when this is the only pane. */
  onClosePane?: () => void
  /** Its tabs are rendered by the top bar (single-pane layout). */
  hideTabs?: boolean
  /** Present when tabs can be dragged: absent on a phone, where they cannot. */
  tabDrop?: PaneTabDrop
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

/**
 * Where a dragged tab lands: the pane's strip inserts it between two tabs, its
 * body moves it in (centre) or splits the pane (the four sides).
 */
export interface PaneTabDrop {
  onDropAt: (source: TabDragSource, index: number) => void
  onDropZone: (source: TabDragSource, zone: DropZone) => void
  /** False once the pane budget is spent: only the centre still accepts a drop. */
  canSplit: boolean
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
  canvasFiles,
  onOpenNote,
  onFocus,
  onActivateTab,
  onCloseTab,
  onNewNote,
  onRenameNote,
  onClosePane,
  hideTabs = false,
  tabDrop,
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
  const t = useT()
  const activeTabId = pane.activeTabId
  const hasTab = pane.tabs.some((tab) => tab.id === activeTabId)

  return (
    <section
      className={`workspace-pane${focused ? ' focused' : ''}`}
      aria-label={t('pane.label')}
      onPointerDownCapture={onFocus}
    >
      {!hideTabs && (
        <TabStrip
          paneId={pane.id}
          tabs={pane.tabs.map((tab) => ({ id: tab.id, title: titles.get(tab.noteId) ?? '' }))}
          onDropTab={tabDrop?.onDropAt}
          activeTabId={activeTabId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onNewNote={onNewNote}
          onRename={
            onRenameNote
              ? (tabId, title) => {
                  const tab = pane.tabs.find((candidate) => candidate.id === tabId)
                  if (tab) onRenameNote(tab.noteId, title)
                }
              : undefined
          }
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          splitLimitLabel={splitLimitLabel}
          onClosePane={onClosePane}
        />
      )}

      {tabDrop && (
        <PaneDropTarget
          paneId={pane.id}
          tabCount={pane.tabs.length}
          canSplit={tabDrop.canSplit}
          belowTabs={!hideTabs}
          onDrop={tabDrop.onDropZone}
        />
      )}

      <div className={note?.kind === 'canvas' ? 'scroll scroll--canvas' : 'scroll'}>
        {noteError && (
          <p className="hint tone-danger" style={{ padding: '16px 24px' }}>
            {noteError}
          </p>
        )}

        {!hasTab && (
          <div className="empty" style={{ minHeight: '50vh' }}>
            <p className="empty-title">
              {emptyWorkspace ? t('pane.emptyTitle') : t('pane.emptyPaneTitle')}
            </p>
            <p className="hint" style={{ maxWidth: 340, textAlign: 'center' }}>
              {emptyWorkspace ? t('pane.emptyHint') : t('pane.emptyPaneHint')}
            </p>
            <div className="row">
              <button className="btn" onClick={onNewNote}>
                {t('pane.createNote')}
              </button>
              {emptyWorkspace && (
                <button className="btn ghost" onClick={onImport}>
                  {t('pane.importVault')}
                </button>
              )}
            </div>
          </div>
        )}

        {hasTab && !note && !noteError && (
          <p className="hint" style={{ padding: '16px 24px' }}>
            {creating ? t('pane.creating') : t('pane.loading')}
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
            creating={creating}
            canvasFiles={canvasFiles}
            onOpenNote={onOpenNote}
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
