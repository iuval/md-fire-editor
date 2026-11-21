import { useEffect, useRef } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  onTitleChange: (title: string) => void
}

export function Editor({ value, onChange, onTitleChange }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const isReadyRef = useRef(false)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  useEffect(() => {
    if (!containerRef.current || vditorRef.current) return

    const vditor = new Vditor(containerRef.current, {
      value,
      mode: isMobile ? 'sv' : 'ir',
      minHeight: 400,
      height: '100%',
      width: '100%',
      placeholder: 'Start writing...',
      theme: 'classic',
      preview: {
        theme: {
          current: 'light',
        },
        hljs: {
          style: 'github',
          lineNumber: true,
        },
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        '|',
        'line',
        'quote',
        'list',
        'ordered-list',
        'check',
        '|',
        'code',
        'inline-code',
        'link',
        'table',
        '|',
        'upload',
        'record',
        '|',
        'edit-mode',
        'both',
        'preview',
        '|',
        'undo',
        'redo',
        '|',
        'fullscreen',
        'outline',
      ],
      toolbarConfig: {
        pin: false,
      },
      cache: {
        enable: false,
      },
      after: () => {
        isReadyRef.current = true
        vditorRef.current = vditor
      },
      input: (v) => {
        onChange(v)
        // Extract first H1 as title
        const h1Match = v.match(/^#\s+(.+)/m)
        if (h1Match) {
          onTitleChange(h1Match[1].trim())
        } else {
          // First line if no H1
          const firstLine = v.split('\n')[0].trim()
          if (firstLine) {
            onTitleChange(firstLine.slice(0, 60))
          }
        }
      },
    })

    return () => {
      vditor.destroy()
      vditorRef.current = null
      isReadyRef.current = false
    }
  }, [])

  // Update value when note changes (only if different from current)
  useEffect(() => {
    if (vditorRef.current && isReadyRef.current) {
      const current = vditorRef.current.getValue()
      if (current !== value) {
        vditorRef.current.setValue(value)
      }
    }
  }, [value])

  return <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
}
