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
})
