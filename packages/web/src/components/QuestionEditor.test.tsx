import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionEditor } from './QuestionEditor'

describe('QuestionEditor', () => {
  it('shows question text and an edit button by default', () => {
    render(<QuestionEditor question="原问题" onResubmit={() => {}} />)
    expect(screen.getByText('原问题')).toBeInTheDocument()
    expect(screen.getByLabelText('编辑问题并重新生成')).toBeInTheDocument()
    expect(screen.queryByLabelText('edit-question')).toBeNull()
  })
  it('enters edit mode prefilled and resubmits trimmed on Enter', () => {
    const onResubmit = vi.fn()
    render(<QuestionEditor question="原问题" onResubmit={onResubmit} />)
    fireEvent.click(screen.getByLabelText('编辑问题并重新生成'))
    const ta = screen.getByLabelText('edit-question')
    expect(ta).toHaveValue('原问题')
    fireEvent.change(ta, { target: { value: '  改后的问题  ' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(onResubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onResubmit).toHaveBeenCalledWith('改后的问题')
  })
  it('cancel exits edit mode without resubmitting', () => {
    const onResubmit = vi.fn()
    render(<QuestionEditor question="原问题" onResubmit={onResubmit} />)
    fireEvent.click(screen.getByLabelText('编辑问题并重新生成'))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onResubmit).not.toHaveBeenCalled()
    expect(screen.getByText('原问题')).toBeInTheDocument()
  })
  it('does not enter edit mode when disabled', () => {
    render(<QuestionEditor disabled question="原问题" onResubmit={() => {}} />)
    fireEvent.click(screen.getByLabelText('编辑问题并重新生成'))
    expect(screen.queryByLabelText('edit-question')).toBeNull()
  })
  it('keeps a pasted image and edited text when regeneration fails', async () => {
    const onResubmit = vi.fn().mockRejectedValue(new Error('failed'))
    render(<QuestionEditor question="原问题" onResubmit={onResubmit} />)
    fireEvent.click(screen.getByLabelText('编辑问题并重新生成'))
    const editor = screen.getByLabelText('edit-question')
    fireEvent.change(editor, { target: { value: '新问题' } })
    fireEvent.paste(editor, { clipboardData: { files: [new File(['x'], 'q.png', { type: 'image/png' })], items: [] } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重新生成' }))
    expect(onResubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    await screen.findByText('重新生成失败，文字和图片均已保留。')
    expect(editor).toHaveValue('新问题')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
  })
})
