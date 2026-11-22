import { memo, useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Link2 } from 'lucide-react'
import type { CanvasNode } from '../lib/canvas/model'
import type { CanvasFileRef } from '../lib/canvas/files'
import { parseCardMarkdown, type Block, type Inline } from '../lib/canvas/markdownCard'
import type { Rect } from '../lib/canvas/geometry'
import { canvasColor } from '../lib/canvas/colors'

/**
 * One card. Presentation only: the surface owns selection, dragging, resizing
 * and menus, and passes the rect it should paint (a drag shows a preview rect
 * before anything is written to the document).
 *
 * Text is markdown: rendered while idle, raw while editing — Obsidian's model,
 * and the reason no rich-text editor is mounted per card (each ProseMirror
 * instance costs megabytes; a canvas can hold sixty cards).
 */
export interface CanvasCardProps {
  node: CanvasNode
  rect: Rect
  text: string
  selected: boolean
  editing: boolean
  editingLabel: boolean
  editable: boolean
  resolved: CanvasFileRef | null
  onCommitText: (text: string) => void
  onCommitLabel: (label: string) => void
  onStartEdit: () => void
  onStartEditLabel: () => void
  onOpenFile: () => void
}

function colorStyle(color: string | undefined): React.CSSProperties | undefined {
  const value = canvasColor(color)
  return value ? { ['--canvas-color' as string]: value } : undefined
}

function InlineRun({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((inline, index) => {
        switch (inline.kind) {
          case 'text':
            return <span key={index}>{inline.text}</span>
          case 'break':
            return <br key={index} />
          case 'strong':
            return (
              <strong key={index}>
                <InlineRun nodes={inline.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={index}>
                <InlineRun nodes={inline.children} />
              </em>
            )
          case 'strike':
            return (
              <s key={index}>
                <InlineRun nodes={inline.children} />
              </s>
            )
          case 'code':
            return <code key={index}>{inline.text}</code>
          case 'tag':
            return (
              <span key={index} className="canvas-tag">
                #{inline.tag}
              </span>
            )
          case 'wikilink':
            return (
              <span key={index} className="canvas-wikilink" title={inline.target}>
                {inline.label}
              </span>
            )
          case 'link':
            return (
              <a
                key={index}
                href={inline.href}
                target="_blank"
                rel="noreferrer noopener"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <InlineRun nodes={inline.children} />
              </a>
            )
        }
      })}
    </>
  )
}

function Lines({ lines }: { lines: Inline[][] }) {
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          <InlineRun nodes={line} />
        </span>
      ))}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = (`h${Math.min(6, Math.max(1, block.level))}` as unknown) as 'h1'
      return (
        <Tag className="canvas-h">
          <Lines lines={block.lines} />
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote>
          <Lines lines={block.lines} />
        </blockquote>
      )
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>
              {item.checked !== undefined && (
                <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
              )}
              <Lines lines={item.lines} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Lines lines={block.lines} />
        </p>
      )
  }
}

/** Memoised on purpose: 60 cards re-render on every drag frame, and re-parsing
 * 21 KB of markdown each time would make a move feel like a slideshow. */
export const CardMarkdown = memo(function CardMarkdown({ source }: { source: string }) {
  const blocks = parseCardMarkdown(source)
  if (blocks.length === 0) return <p className="canvas-placeholder">Tarjeta vacía</p>
  return (
    <div className="canvas-md">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
})

function TextEditor({
  initial,
  onCommit,
}: {
  initial: string
  onCommit: (text: string) => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const committed = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [])

  const commit = () => {
    if (committed.current) return
    committed.current = true
    onCommit(value)
  }

  return (
    <textarea
      ref={ref}
      className="canvas-editor"
      value={value}
      spellCheck
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // The surface listens for Delete/Backspace/Cmd+A: inside the editor
        // those keys belong to the text, not to the canvas.
        event.stopPropagation()
        if (event.key === 'Escape') commit()
      }}
    />
  )
}

function LabelEditor({ initial, onCommit }: { initial: string; onCommit: (label: string) => void }) {
  const [value, setValue] = useState(initial)
  const committed = useRef(false)
  const commit = () => {
    if (committed.current) return
    committed.current = true
    onCommit(value)
  }
  return (
    <input
      className="canvas-label-input"
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter' || event.key === 'Escape') commit()
      }}
    />
  )
}

export function CanvasCard({
  node,
  rect,
  text,
  selected,
  editing,
  editingLabel,
  editable,
  resolved,
  onCommitText,
  onCommitLabel,
  onStartEdit,
  onStartEditLabel,
  onOpenFile,
}: CanvasCardProps) {
  const isGroup = node.type === 'group'
  const style: React.CSSProperties = {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: rect.width,
    height: rect.height,
    ...colorStyle(node.color),
  }

  const className = [
    'canvas-node',
    `canvas-node--${isGroup ? 'group' : node.type}`,
    node.color ? 'canvas-node--colored' : '',
    selected ? 'is-selected' : '',
    editing ? 'is-editing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={style}
      data-node-id={node.id}
      data-node-type={node.type}
      role={isGroup ? 'group' : 'button'}
      tabIndex={-1}
      onDoubleClick={(event) => {
        if (!editable) return
        event.stopPropagation()
        if (isGroup) onStartEditLabel()
        else if (node.type === 'text') onStartEdit()
        else if (node.type === 'file') onOpenFile()
        else if (node.type === 'link' && node.url) window.open(node.url, '_blank', 'noopener')
      }}
    >
      {isGroup ? (
        <div className="canvas-group-label">
          {editingLabel ? (
            <LabelEditor initial={node.label ?? ''} onCommit={onCommitLabel} />
          ) : (
            <span data-group-label={node.id}>{node.label || 'Grupo'}</span>
          )}
        </div>
      ) : node.type === 'text' ? (
        editing ? (
          <TextEditor initial={text} onCommit={onCommitText} />
        ) : (
          <CardMarkdown source={text} />
        )
      ) : node.type === 'file' ? (
        <div className="canvas-file">
          <FileText size={16} className="canvas-file-icon" />
          <div className="canvas-file-body">
            <span className="canvas-file-title">{resolved?.title ?? node.file ?? 'Archivo'}</span>
            {node.subpath && <span className="canvas-file-sub">{node.subpath}</span>}
            {!resolved && (
              <span className="canvas-file-missing">
                {node.file?.match(/\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|wav)$/i)
                  ? 'adjunto no guardado'
                  : 'nota no encontrada'}
              </span>
            )}
          </div>
        </div>
      ) : node.type === 'link' ? (
        <div className="canvas-link">
          <Link2 size={16} className="canvas-file-icon" />
          <div className="canvas-file-body">
            <span className="canvas-file-title">{node.url ?? 'Enlace'}</span>
          </div>
          {node.url && (
            <button
              className="icon-btn icon-btn--sm"
              aria-label="Abrir enlace"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                window.open(node.url!, '_blank', 'noopener')
              }}
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      ) : (
        // A type a newer Obsidian wrote: show something instead of losing it.
        <div className="canvas-file">
          <FileText size={16} className="canvas-file-icon" />
          <div className="canvas-file-body">
            <span className="canvas-file-title">{node.type}</span>
          </div>
        </div>
      )}
    </div>
  )
}
