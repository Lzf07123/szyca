import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  title: string
  message: ReactNode
  details?: ReactNode[]
  confirmLabel: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  details = [],
  confirmLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleID = useId()
  const messageID = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [])

  return createPortal(
    <div className="modal-veil confirm-veil" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className={`modal confirm-dialog ${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={messageID}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="section-eyebrow">CONFIRM ACTION</p>
        <h3 id={titleID}>{title}</h3>
        <p id={messageID} className="confirm-message">{message}</p>
        {details.length > 0 && (
          <ul className="side-effects">
            {details.map((detail, index) => <li key={index}>{detail}</li>)}
          </ul>
        )}
        <div className="modal-actions">
          <button ref={cancelRef} className="btn" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
