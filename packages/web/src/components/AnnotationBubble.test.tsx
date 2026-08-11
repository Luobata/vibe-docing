import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generationTaskRegistry } from '../state/workbench-store'
import { AnnotationBubble } from './AnnotationBubble'

describe('AnnotationBubble', () => {
  beforeEach(() => generationTaskRegistry.reset())
  it('supports notes, fork questions, cancellation, and initial focus', () => {
    const onCreateNote = vi.fn()
    const onDismiss = vi.fn()
    const onForkExpand = vi.fn()
    render(
      <AnnotationBubble
        onCreateNote={onCreateNote}
        onDismiss={onDismiss}
        onForkExpand={onForkExpand}
        selection={{ from: 0, text: 'Redis', to: 5 }}
      />,
    )

    expect(screen.getByLabelText('note')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('note'), { target: { value: '需要复核' } })
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }))
    expect(onCreateNote).toHaveBeenCalledWith('需要复核')
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '它怎么持久化？' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))
    expect(onForkExpand).toHaveBeenCalledWith('它怎么持久化？')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('disables expand only while the same selection task is live', () => {
    const taskKey = 'fork-expand:root:0:3'
    generationTaskRegistry.start({
      key: taskKey,
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })
    render(
      <AnnotationBubble
        onCreateNote={() => {}}
        onDismiss={() => {}}
        onForkExpand={() => {}}
        selection={sel}
        taskKey={taskKey}
      />,
    )
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '继续' } })
    expect(screen.getByRole('button', { name: '就此展开' })).toBeDisabled()
    expect(screen.getByText('该选区的展开正在进行中')).toHaveAttribute('data-gen-status', 'streaming')
  })
})

const sel = { from: 0, to: 3, text: '内存' } as never

describe('AnnotationBubble image+keyboard', () => {
  it('submits note on Enter (Shift+Enter does not)', () => {
    const onCreateNote = vi.fn()
    render(<AnnotationBubble onCreateNote={onCreateNote} onDismiss={() => {}} onForkExpand={() => {}} selection={sel} />)
    const note = screen.getByLabelText('note')
    fireEvent.change(note, { target: { value: '待验证' } })
    fireEvent.keyDown(note, { key: 'Enter', shiftKey: true })
    expect(onCreateNote).not.toHaveBeenCalled()
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(onCreateNote).toHaveBeenCalledWith('待验证')
  })
  it('submits fork question on Enter', () => {
    const onForkExpand = vi.fn()
    render(<AnnotationBubble initialFocus="expand" onCreateNote={() => {}} onDismiss={() => {}} onForkExpand={onForkExpand} selection={sel} />)
    const q = screen.getByLabelText('fork-question')
    fireEvent.change(q, { target: { value: '继续追问' } })
    fireEvent.keyDown(q, { key: 'Enter' })
    expect(onForkExpand).toHaveBeenCalledWith('继续追问')
  })
  it('asks before discarding a note image and only clears it after success', async () => {
    const onCreateNote = vi.fn().mockResolvedValue(undefined)
    render(<AnnotationBubble onCreateNote={onCreateNote} onDismiss={() => {}} onForkExpand={() => {}} selection={sel} />)
    const note = screen.getByLabelText('note')
    fireEvent.change(note, { target: { value: '带图笔记' } })
    fireEvent.paste(note, { clipboardData: { files: [new File(['x'], 'note.png', { type: 'image/png' })], items: [] } })
    fireEvent.click(screen.getByRole('button', { name: '保存笔记' }))
    expect(onCreateNote).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    await waitFor(() => expect(screen.queryByTestId('chat-image-thumb')).toBeNull())
    expect(onCreateNote).toHaveBeenCalledWith('带图笔记')
  })
})
