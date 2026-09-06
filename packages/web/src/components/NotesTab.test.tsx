import { render, screen, fireEvent } from '@testing-library/react'
import type { AnnotationRow } from '@vibe/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../state/workbench-store'
import { NotesTab } from './NotesTab'

const ann = (over: Partial<AnnotationRow>): AnnotationRow => ({
  id: 'a1', node_id: 'n1', kind: 'selection', anchor_from: 0, anchor_to: 3,
  quoted_text: '内存快', note: '待验证', child_node_id: null, created_at: '', ...over,
})

describe('NotesTab', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  it('lists only note annotations (child_node_id null) and fires onJump', () => {
    const onJump = vi.fn()
    render(<NotesTab annotations={[ann({}), ann({ id: 'a2', child_node_id: 'c1', note: null })]} canCreateNote={true} onJump={onJump} onCreateNote={() => {}} />)
    expect(screen.getByText('待验证')).toBeInTheDocument()
    fireEvent.click(screen.getByText('待验证'))
    expect(onJump).toHaveBeenCalledWith('a1')
  })
  it('shows empty state when no notes', () => {
    render(<NotesTab annotations={[]} canCreateNote={true} onJump={() => {}} onCreateNote={() => {}} />)
    expect(screen.getByText('还没有笔记')).toBeInTheDocument()
  })
})

describe('NotesTab create', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  it('submits a new note on Enter and clears', () => {
    const onCreateNote = vi.fn()
    render(<NotesTab annotations={[]} canCreateNote={true} onJump={() => {}} onCreateNote={onCreateNote} />)
    const input = screen.getByLabelText('新笔记内容')
    fireEvent.change(input, { target: { value: '一条新笔记' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateNote).toHaveBeenCalledWith('一条新笔记')
    expect(input).toHaveValue('')
  })

  it('grows the note composer with its content up to the visual cap', () => {
    render(<NotesTab annotations={[]} canCreateNote={true} onJump={() => {}} onCreateNote={() => {}} />)
    const input = screen.getByLabelText('新笔记内容') as HTMLTextAreaElement
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 120 })

    fireEvent.change(input, { target: { value: '第一行\n第二行\n第三行' } })

    expect(input.style.height).toBe('120px')
  })

  it('disables the input and skips submit when there is no document', () => {
    const onCreateNote = vi.fn()
    render(<NotesTab annotations={[]} canCreateNote={false} onJump={() => {}} onCreateNote={onCreateNote} />)
    const input = screen.getByLabelText('新笔记内容')
    expect(input).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateNote).not.toHaveBeenCalled()
  })

  it('keeps the draft attachment when confirmed save fails', async () => {
    const onCreateNote = vi.fn().mockRejectedValue(new Error('failed'))
    render(<NotesTab annotations={[]} canCreateNote={true} onJump={() => {}} onCreateNote={onCreateNote} />)
    const input = screen.getByLabelText('新笔记内容')
    fireEvent.change(input, { target: { value: '不能丢的笔记' } })
    fireEvent.paste(input, { clipboardData: { files: [new File(['x'], 'note.png', { type: 'image/png' })], items: [] } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    await screen.findByText('笔记保存失败，文字和图片均已保留。')
    expect(input).toHaveValue('不能丢的笔记')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
  })
})

describe('NotesTab anchor highlight', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  it('flashes the anchored note and clears anchoredNoteId', () => {
    useWorkbench.getState().setAnchoredNoteId('a1')
    render(<NotesTab annotations={[ann({})]} canCreateNote={true} onJump={() => {}} onCreateNote={() => {}} />)
    const item = screen.getByText('待验证').closest('.note-item')
    expect(item).toHaveClass('ann-flash')
    expect(useWorkbench.getState().anchoredNoteId).toBeNull()
  })
})
