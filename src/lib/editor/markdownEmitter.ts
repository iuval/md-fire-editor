import { sameMarkdown } from '../markdown'

/**
 * Turns editor `update` events into markdown for the note document.
 *
 * `update` fires per keystroke, and the only way to know what the document says
 * is to serialise the *whole* document back to markdown: ~0.55 ms and one copy
 * of the body (~200 KB for a 100 KB note) per keystroke, which is pure garbage
 * while typing. Nothing needs the string that often — the save is debounced by
 * more than a second anyway — so this class serialises a burst of keystrokes
 * once and remembers the rest.
 *
 * It also owns the two rules that stop a *read* from becoming a write:
 *   - an external change applied into the document must not be echoed back
 *     (`adopt`), and
 *   - the transient empty document the editor emits while rebuilding is not a
 *     user deleting everything.
 */
export interface MarkdownEmitterOptions {
  /** Trailing delay: a burst of keystrokes serialises once. */
  idleMs?: number
  /** Markdown the document holds right now (after `onCreate`). */
  initial: string
}

export interface MarkdownEmitterPorts {
  /** Full-document serialisation: called at most once per burst. */
  serialize: () => string
  /** Called with markdown that really differs from what was already emitted. */
  emit: (markdown: string) => void
}

export const DEFAULT_EMIT_IDLE_MS = 400

export class MarkdownEmitter {
  private readonly idleMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private ports: MarkdownEmitterPorts | null = null
  /** Last markdown this emitter emitted, or adopted from outside. */
  private last: string

  constructor(options: MarkdownEmitterOptions) {
    this.idleMs = options.idleMs ?? DEFAULT_EMIT_IDLE_MS
    this.last = options.initial
  }

  /**
   * Where the markdown comes from and where it goes. Connected once the editor
   * instance exists, instead of being captured during render.
   */
  configure(ports: MarkdownEmitterPorts): void {
    this.ports = ports
  }

  /** An editor update happened. Serialisation waits for the burst to end. */
  markDirty(): void {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.idleMs)
  }

  /** Mark `markdown` as already known, so it is never emitted as an edit. */
  adopt(markdown: string): void {
    this.last = markdown
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Serialise now and emit if the document really changed. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.ports) return
    const markdown = this.ports.serialize()
    if (!markdown.trim() && this.last.trim()) return
    if (sameMarkdown(markdown, this.last)) {
      this.last = markdown
      return
    }
    this.last = markdown
    this.ports.emit(markdown)
  }

  /** Flushes whatever is pending (a tab closed mid-typing) and stops. */
  dispose(): void {
    if (this.timer) this.flush()
    this.disposed = true
  }
}
