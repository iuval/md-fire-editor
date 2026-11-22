import { liveNoteSessions } from './collab/noteSession'
import type { Note } from './notes'

/**
 * What this tab is actually holding.
 *
 * "The app is using 1 GB" is usually the browser (every tab, the GPU process and
 * every extension) or a dev build, not the app's data: four open notes are a few
 * MB. These are the numbers that separate the two, read from inside the page so
 * they can be compared with what the browser's task manager shows.
 */
export interface MemoryReport {
  /** V8 heap in use, in bytes. Chromium only: `performance.memory`. */
  usedHeap: number | null
  /** The ceiling that crashes the tab, not what the app needs. */
  heapLimit: number | null
  /** Elements in the document: what makes a dev build differ from a production one. */
  domNodes: number
  /** Notes with a live Yjs document + transport. Should be one per visible pane. */
  openNoteSessions: number
}

interface HeapMemory {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
  totalJSHeapSize: number
}

export function memoryReport(): MemoryReport {
  const memory = (performance as unknown as { memory?: HeapMemory }).memory
  return {
    usedHeap: memory?.usedJSHeapSize ?? null,
    heapLimit: memory?.jsHeapSizeLimit ?? null,
    domNodes: typeof document === 'undefined' ? 0 : document.getElementsByTagName('*').length,
    openNoteSessions: liveNoteSessions(),
  }
}

/** IndexedDB + Cache storage, which is disk, not heap — but it is part of RAM pressure. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

export interface PendingBodies {
  /** Notes whose body still travels in the workspace list. */
  count: number
  /** Characters of body being downloaded on every cold start until migrated. */
  characters: number
}

export function pendingBodies(notes: Note[]): PendingBodies {
  let count = 0
  let characters = 0
  for (const note of notes) {
    if (!note.markdown || note.markdownBytes !== undefined) continue
    count++
    characters += note.markdown.length
  }
  return { count, characters }
}
