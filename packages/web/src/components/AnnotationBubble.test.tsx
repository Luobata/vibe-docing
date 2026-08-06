import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnnotationBubble } from './AnnotationBubble'

describe('AnnotationBubble', () => {
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
})
