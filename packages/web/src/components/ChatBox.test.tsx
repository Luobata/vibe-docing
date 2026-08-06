import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatBox } from './ChatBox'

describe('ChatBox', () => {
  it('submits trimmed text and clears the composer', () => {
    const onSubmit = vi.fn()
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: '  继续说说  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('继续说说')
    expect(input).toHaveValue('')
  })

  it('supports the Ctrl+Enter keyboard path and disabled state', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '键盘提交' } })
    fireEvent.keyDown(screen.getByLabelText('chat-input'), { ctrlKey: true, key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('键盘提交')
    rerender(<ChatBox disabled onSubmit={onSubmit} />)
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled()
  })

  it('sends on plain Enter and clears', () => {
    const onSubmit = vi.fn()
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: '回车发送' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('回车发送')
    expect(input).toHaveValue('')
  })

  it('inserts a newline on Shift+Enter without submitting', () => {
    const onSubmit = vi.fn()
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: '第一行' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit while an IME composition is active', () => {
    const onSubmit = vi.fn()
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: '拼音' } })
    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('previews a pasted image and lets it be removed', () => {
    render(<ChatBox disabled={false} onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('chat-input')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { files: [file], items: [] } })
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByTestId('chat-image-thumb')).toBeNull()
  })

  it('submits plain text with a degrade hint when images are attached', () => {
    const onSubmit = vi.fn()
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { files: [file], items: [] } })
    fireEvent.change(input, { target: { value: '看这张图' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // still submits plain text only — no multimodal payload
    expect(onSubmit).toHaveBeenCalledWith('看这张图')
    expect(screen.getByTestId('image-degrade-hint')).toBeInTheDocument()
    // thumbnails cleared after submit
    expect(screen.queryByTestId('chat-image-thumb')).toBeNull()
  })
})
