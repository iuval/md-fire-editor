/**
 * English catalogue — the source of truth for every user-visible string.
 *
 * Rules for translators (and for adding a language):
 * - Keys mirror the surface that shows the text, not the Spanish original.
 * - Values are plain strings; `{name}` marks a placeholder passed as a param.
 * - Counts use `plural(count, { one, other })`, never a hand-written "s" suffix.
 * - Keep values free of markup; components wrap them in `<strong>`/`<code>`.
 */
export const en = {
  app: {
    loading: 'Loading…',
    untitled: 'Untitled',
    noAccess: 'This note does not exist or you do not have access.',
    loadingEditor: 'Loading editor…',
  },
  note: {
    deleteConfirm: 'Delete "{title}"?',
  },
  auth: {
    title: 'Your Markdown notes, in folders, shared.',
    subtitleBefore: 'Real-time editing over your Obsidian vault. What you write stays a ',
    subtitleAfter: '.',
    signIn: 'Sign in with Google',
    embeddedTitle: 'Google will refuse this browser.',
    embeddedOpenIn: 'Open this address in Chrome or Safari:',
  },
  sidebar: {
    label: 'Notes and folders',
    newNote: 'New note',
    newFolder: 'New folder',
    newCanvas: 'New canvas',
    closePanel: 'Close panel',
    hidePanel: 'Hide panel',
    showPanel: 'Show panel',
    account: 'Account and settings',
    accountOf: '{name} · Account and settings',
    noteActions: 'Actions for {title}',
    folderActions: 'Actions for {name}',
    tags: 'Tags',
    filterByTag: 'Filter by tag',
    showTags: 'Show tags',
    hideTags: 'Hide tags',
    clearTagFilter: 'Clear tag filter',
    clearTagFilterShort: 'Clear filter',
    syncStatus: 'Sync status: {status}',
    resize: 'Panel width',
    resizeHint: 'Drag to resize (double-click to reset)',
  },
  rail: {
    openNotes: 'Notes panel',
    account: 'Account and settings',
  },
  tabs: {
    close: 'Close {title}',
    closeShort: 'Close',
    newNote: 'New note',
    splitRight: 'Split right',
    splitDown: 'Split down',
    closePane: 'Close pane',
    renameOf: 'Rename {title}',
  },
  paneBar: {
    openNotes: 'Open notes',
    tagFilterActive: 'Tag filter on',
    clearTagFilter: 'Clear tag filter',
    editingNow: 'Editing now',
  },
  desktop: {
    invalidLink: 'This link does not work',
    missingToken: 'I could not read the session token. Sign out and sign in again.',
    rejected: 'The desktop app rejected the connection ({status}).',
    connected: 'Done, account connected',
    connect: 'Connect the app',
    signIn: 'Sign in with Google',
  },
  access: {
    restricted: 'Private',
    linkView: 'Anyone with the link can read',
    linkEdit: 'Anyone with the link can edit',
  },
  role: {
    owner: 'Owner',
    editor: 'Can edit',
    viewer: 'Read only',
  },
  sync: {
    error: 'Sync error',
    offline: 'Offline',
    saving: 'Saving',
    connecting: 'Connecting',
    synced: 'Synced',
    offlineDetail: 'Your changes are saved here and sync when you reconnect.',
    unsentOne: '{count} change not sent yet',
    unsentOther: '{count} changes not sent yet',
  },
  sort: {
    manual: 'Manual',
    name: 'Name',
    created: 'Date created',
    updated: 'Date modified',
  },
  crash: {
    title: 'Something broke',
    body: 'It has been reported. Reload the page: your notes are saved on the server and you will land back in your session.',
    reload: 'Reload',
  },
} as const
