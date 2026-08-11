import { useId, useLayoutEffect, useRef } from 'react'

export function ConfirmDialog({
  busy = false,
  confirmLabel = '删除',
  error,
  message,
  onCancel,
  onConfirm,
  returnFocusTo,
  title = '确认删除',
}: {
  busy?: boolean
  confirmLabel?: string
  error?: string | null
  message: string
  onCancel(): void
  onConfirm(): void | Promise<void>
  returnFocusTo?: HTMLElement | null
  title?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    cancelRef.current?.focus()

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  function cancel(): void {
    if (busy) return
    onCancel()
    setTimeout(() => returnFocusTo?.focus(), 0)
  }

  return (
    <dialog
      aria-busy={busy}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="confirm-dialog"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }}
      ref={dialogRef}
      role="alertdialog"
    >
      <div className="confirm-dialog-content">
        <h2 id={titleId}>{title}</h2>
        <p className="confirm-dialog-description" id={descriptionId}>{message}</p>
        {error && <p className="inline-error confirm-dialog-error" role="alert">{error}</p>}
        <div className="confirm-dialog-actions">
          <button autoFocus className="quiet-button" disabled={busy} onClick={cancel} ref={cancelRef} type="button">
            取消
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => { void onConfirm() }}
            type="button"
          >
            {busy ? '删除中…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
