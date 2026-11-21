// Visual-review stub: y-protocols-Awareness-compatible surface, no transport.
// Only used by the gallery harness (vite.gallery.config.ts).
import type * as Y from 'yjs'

export interface CollabUser {
  name: string
  color: string
}

export interface AwarenessUser extends CollabUser {
  uid: string
  clientId: number
}

export class FirestoreAwareness {
  readonly clientID: number
  private localState: Record<string, unknown> | null = null
  private states = new Map<number, Record<string, unknown>>()
  private listeners = new Set<(...args: unknown[]) => void>()
  private userListeners = new Set<(users: AwarenessUser[]) => void>()

  constructor(
    private readonly noteId: string,
    private readonly uid: string,
    private readonly user: CollabUser,
    ydoc: Y.Doc
  ) {
    this.clientID = ydoc.clientID
  }

  getLocalState(): Record<string, unknown> | null {
    return this.localState
  }

  setLocalState(state: Record<string, unknown> | null): void {
    this.localState = state
  }

  setLocalStateField(field: string, value: unknown): void {
    this.localState = { ...(this.localState ?? {}), [field]: value }
  }

  getStates(): Map<number, Record<string, unknown>> {
    return this.states
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    if (event === 'update') this.listeners.add(listener)
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    if (event === 'update') this.listeners.delete(listener)
  }

  onUserChange(listener: (users: AwarenessUser[]) => void): () => void {
    this.userListeners.add(listener)
    return () => this.userListeners.delete(listener)
  }

  connect(): void {
    void this.noteId
    void this.uid
    void this.user
  }

  destroy(): void {
    this.listeners.clear()
    this.userListeners.clear()
  }
}
