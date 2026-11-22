import { useState } from 'react'
import {
  currentTabDrag,
  dropZoneAt,
  endTabDrag,
  type DropZone,
  type TabDragSource,
} from '../lib/tabDrag'

/** What the highlighted area promises, in the same words as the split buttons. */
const DROP_LABELS: Record<DropZone, string> = {
  left: 'Dividir a la izquierda',
  right: 'Dividir a la derecha',
  top: 'Dividir arriba',
  bottom: 'Dividir abajo',
  center: 'Mover acá',
}

interface PaneDropTargetProps {
  paneId: string
  /** Tabs in this pane: with one, splitting it against itself is a no-op. */
  tabCount: number
  /** False once the pane budget is spent: only the centre still accepts a drop. */
  canSplit: boolean
  /** True when the pane's own strip sits above this surface. */
  belowTabs?: boolean
  onDrop: (source: TabDragSource, zone: DropZone) => void
}

/**
 * The pane's body as one drop surface, while a tab is being dragged.
 *
 * One element and no children to cross, so the highlight never flickers as the
 * pointer travels over the document; it listens only while a tab is in flight
 * (`body.tab-dragging`), so an idle pane stays clickable everywhere.
 */
export function PaneDropTarget({
  paneId,
  tabCount,
  canSplit,
  belowTabs = false,
  onDrop,
}: PaneDropTargetProps) {
  const [zone, setZone] = useState<DropZone | null>(null)

  /** The zone under the pointer, or null where a drop would do nothing. */
  const zoneAt = (event: React.DragEvent<HTMLDivElement>): DropZone | null => {
    const source = currentTabDrag()
    if (!source) return null
    const found = dropZoneAt(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
    if (found === 'center') return source.paneId === paneId ? null : found
    if (!canSplit) return null
    // Dragging a pane's only tab onto that same pane's edge collapses back into
    // one pane, so promising a split there would be a lie.
    if (source.paneId === paneId && tabCount <= 1) return null
    return found
  }

  const clear = () => {
    if (zone) setZone(null)
  }

  return (
    <div
      className={`pane-drop${belowTabs ? ' pane-drop--below-tabs' : ''}`}
      data-zone={zone ?? undefined}
      aria-hidden="true"
      onDragOver={(event) => {
        const next = zoneAt(event)
        if (!next) {
          clear()
          return
        }
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        if (next !== zone) setZone(next)
      }}
      onDragLeave={clear}
      onDrop={(event) => {
        const source = currentTabDrag()
        const next = zoneAt(event)
        setZone(null)
        endTabDrag()
        if (!source || !next) return
        event.preventDefault()
        onDrop(source, next)
      }}
    >
      {zone && <span className="pane-drop-hint">{DROP_LABELS[zone]}</span>}
    </div>
  )
}
