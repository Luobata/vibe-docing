import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function DialogHarness() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button onClick={() => setOpen(true)} ref={triggerRef} type="button">打开删除确认</button>
      {open && (
        <ConfirmDialog
          message="删除后可在回收站恢复。"
          onCancel={() => setOpen(false)}
          onConfirm={() => {}}
          returnFocusTo={triggerRef.current}
        />
      )}
    </>
  )
}

describe('ConfirmDialog', () => {
  it('uses an alertdialog, focuses cancel by default, and restores focus after Escape', async () => {
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: '打开删除确认' })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.tagName).toBe('DIALOG')
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps an inline error visible and disables actions while deletion is busy', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        busy
        error="删除失败，请稍后重试。"
        message="确认删除此项。"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请稍后重试。')
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除中…' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
