import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../state/workbench-store'
import { ChatBox } from './ChatBox'

function node(id: string): NodeRow {
  return { ai_response: null, created_at: '', id, is_deleted: 0, model_override: null, parent_id: null, sort_order: 0, status: 'complete', tree_id: id, updated_at: '', user_input: id }
}

describe('ChatBox', () => {
  beforeEach(() => useWorkbench.getState().reset())
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

  it('requires confirmation and clears images only after a successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { files: [file], items: [] } })
    fireEvent.change(input, { target: { value: '看这张图' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '确认仅提交文字' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '仅提交文字' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    expect(onSubmit).toHaveBeenCalledWith('看这张图')
    await waitFor(() => expect(screen.queryByTestId('chat-image-thumb')).toBeNull())
  })

  it('retains text and images when the confirmed submit fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'))
    render(<ChatBox disabled={false} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })], items: [] } })
    fireEvent.change(input, { target: { value: '失败也别丢' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    await screen.findByText('提交失败，文字和图片均已保留，请重试。')
    expect(input).toHaveValue('失败也别丢')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
  })

  it('remounts its composer state when the main node changes', () => {
    act(() => useWorkbench.getState().loadTree({ nodes: [node('one')], rootNodeId: 'one', treeId: 'tree-one' }))
    render(<ChatBox disabled={false} onSubmit={() => {}} />)
    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: 'tree one draft' } })
    fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'one.png', { type: 'image/png' })], items: [] } })
    act(() => useWorkbench.getState().loadTree({ nodes: [node('two')], rootNodeId: 'two', treeId: 'tree-two' }))
    expect(screen.getByLabelText('chat-input')).toHaveValue('')
    expect(screen.queryByTestId('chat-image-thumb')).toBeNull()
  })
})

describe('ChatBox vibe:focus-ask', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('focuses the composer textarea when vibe:focus-ask is dispatched', () => {
    render(<ChatBox disabled={false} onSubmit={() => {}} />)
    const input = screen.getByLabelText('chat-input')
    expect(input).not.toHaveFocus()
    act(() => {
      window.dispatchEvent(new CustomEvent('vibe:focus-ask'))
    })
    expect(input).toHaveFocus()
  })
})
