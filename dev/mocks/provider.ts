// Visual-review stub: same public surface as the Firestore Yjs provider, but
// never touches the network. Only used by the gallery harness (vite.gallery.config.ts).
import type * as Y from 'yjs'

export type { ProviderStatus, SyncStats } from '../../src/lib/collab/provider'

export class FirestoreYjsProvider {
  readonly stats = {
    blocksWritten: 0,
    bytesWritten: 0,
    rejectedBlocks: 0,
    blocksApplied: 0,
    bytesApplied: 0,
    compactions: 0,
  }

  private listeners = new Set<(status: unknown) => void>()

  constructor(
    private readonly noteId: string,
    private readonly doc: Y.Doc
  ) {
    void this.noteId
    void this.doc
  }

  onStatus(listener: (status: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect(): void {
    for (const listener of this.listeners) {
      listener({ connected: true, pendingWrites: 0, error: null })
    }
  }

  destroy(): void {
    this.listeners.clear()
  }
}
