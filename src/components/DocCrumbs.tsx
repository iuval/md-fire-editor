import { Fragment } from 'react'
import { folderChain } from '../lib/folders'
import type { Folder } from '../lib/notes'
import { t } from '../i18n/index.ts'

interface DocCrumbsProps {
  /** The note's folder; `null` for a note at the root of the workspace. */
  folderId: string | null | undefined
  folders: Folder[]
}

/**
 * Where the note lives, one line above its title.
 *
 * The pane is the only place a shared note says which folder it came from, and
 * the row in the tree may be scrolled away or collapsed; the path here answers
 * "why can other people read this?" without costing a line of prose. Nothing in
 * the chain is a link: the tree already navigates, and a crumb that only
 * scrolls it would promise more than it does.
 */
export function DocCrumbs({ folderId, folders }: DocCrumbsProps) {
  const chain = folderId ? folderChain(folderId, new Map(folders.map((f) => [f.id, f]))) : []
  // A folder the list has not loaded yet is no path: showing a lone id would be
  // worse than showing nothing.
  if (chain.length === 0) return null

  return (
    <nav className="doc-crumbs" aria-label={t('crumbs.folderOf')}>
      {chain.map((folder, index) => (
        <Fragment key={folder.id}>
          {index > 0 && (
            <span className="doc-crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <span className="doc-crumb">{folder.name}</span>
        </Fragment>
      ))}
    </nav>
  )
}
