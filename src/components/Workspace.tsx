import { useRef, useState } from 'react'
import { useT } from '../i18n/index.ts'
import { findPane, listPanes, type PaneLeaf, type PaneSplit, type PaneTree } from '../lib/panes'

interface WorkspaceProps {
  tree: PaneTree
  focusedPaneId: string
  /** Phones show one pane at a time; the layout is kept for larger screens. */
  isMobile: boolean
  renderPane: (pane: PaneLeaf) => React.ReactNode
  onFocusPane: (paneId: string) => void
  onRatio: (splitId: string, ratio: number) => void
}

/**
 * Renders the split tree. The divider is the only place that knows pixels: it
 * turns a pointer position into a 0..1 ratio and hands that to the layout.
 */
export function Workspace({
  tree,
  focusedPaneId,
  isMobile,
  renderPane,
  onFocusPane,
  onRatio,
}: WorkspaceProps) {
  if (isMobile) {
    const pane = findPane(tree, focusedPaneId) ?? listPanes(tree)[0]
    return <div className="workspace">{pane ? renderPane(pane) : null}</div>
  }

  return (
    <div className="workspace">
      <SplitNode node={tree} renderPane={renderPane} onFocusPane={onFocusPane} onRatio={onRatio} />
    </div>
  )
}

function SplitNode({
  node,
  renderPane,
  onFocusPane,
  onRatio,
}: {
  node: PaneTree
  renderPane: (pane: PaneLeaf) => React.ReactNode
  onFocusPane: (paneId: string) => void
  onRatio: (splitId: string, ratio: number) => void
}) {
  if (node.kind === 'pane') return <>{renderPane(node)}</>
  return (
    <SplitView
      split={node}
      renderPane={renderPane}
      onFocusPane={onFocusPane}
      onRatio={onRatio}
    />
  )
}

function SplitView({
  split,
  renderPane,
  onFocusPane,
  onRatio,
}: {
  split: PaneSplit
  renderPane: (pane: PaneLeaf) => React.ReactNode
  onFocusPane: (paneId: string) => void
  onRatio: (splitId: string, ratio: number) => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const horizontal = split.direction === 'row'

  const ratioFrom = (clientX: number, clientY: number): number | null => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return null
    return horizontal
      ? (clientX - rect.left) / rect.width
      : (clientY - rect.top) / rect.height
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setDragging(true)
    const onMove = (move: PointerEvent) => {
      const ratio = ratioFrom(move.clientX, move.clientY)
      if (ratio !== null) onRatio(split.id, ratio)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
    const backward = horizontal ? 'ArrowLeft' : 'ArrowUp'
    if (event.key === forward) onRatio(split.id, split.ratio + step)
    else if (event.key === backward) onRatio(split.id, split.ratio - step)
    else if (event.key === 'Enter') onRatio(split.id, 0.5)
    else return
    event.preventDefault()
  }

  return (
    <div
      ref={ref}
      className={`split split--${split.direction}${dragging ? ' split--dragging' : ''}`}
    >
      <div className="split-cell" style={{ flex: `${split.ratio} 1 0` }}>
        <SplitNode
          node={split.first}
          renderPane={renderPane}
          onFocusPane={onFocusPane}
          onRatio={onRatio}
        />
      </div>
      <div
        className="split-divider"
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={t('pane.resize')}
        aria-valuenow={Math.round(split.ratio * 100)}
        aria-valuemin={15}
        aria-valuemax={85}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="split-cell" style={{ flex: `${1 - split.ratio} 1 0` }}>
        <SplitNode
          node={split.second}
          renderPane={renderPane}
          onFocusPane={onFocusPane}
          onRatio={onRatio}
        />
      </div>
    </div>
  )
}
