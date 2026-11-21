import { useEffect, useRef, useState } from 'react'

interface InputDialogProps {
  title: string
  label: string
  initialValue?: string
  confirmLabel?: string
  maxLength?: number
  onConfirm: (value: string) => void
  onClose: () => void
}

export function InputDialog({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Guardar',
  maxLength = 120,
  onConfirm,
  onClose,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const clean = value.trim()
    if (!clean) return
    onConfirm(clean)
    onClose()
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="share" role="dialog" aria-modal="true" aria-labelledby="input-dialog-title">
        <h2 id="input-dialog-title">{title}</h2>
        <label className="hint" htmlFor="input-dialog-field">
          {label}
        </label>
        <input
          id="input-dialog-field"
          ref={inputRef}
          className="field"
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
