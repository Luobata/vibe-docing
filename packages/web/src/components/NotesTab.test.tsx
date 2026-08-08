import { render, screen, fireEvent } from '@testing-library/react'
import type { AnnotationRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import { NotesTab } from './NotesTab'

const ann = (over: Partial<AnnotationRow>): AnnotationRow => ({
  id: 'a1', node_id: 'n1', kind: 'selection', anchor_from: 0, anchor_to: 3,
  quoted_text: '内存快', note: '待验证', child_node_id: null, created_at: '', ...over,
})

describe('NotesTab', () => {
  it('lists only note annotations (child_node_id null) and fires onJump', () => {
    const onJump = vi.fn()
    render(<NotesTab annotations={[ann({}), ann({ id: 'a2', child_node_id: 'c1', note: null })]} onJump={onJump} />)
    expect(screen.getByText('待验证')).toBeInTheDocument()
    fireEvent.click(screen.getByText('待验证'))
    expect(onJump).toHaveBeenCalledWith('a1')
  })
  it('shows empty state when no notes', () => {
    render(<NotesTab annotations={[]} onJump={() => {}} />)
    expect(screen.getByText('还没有笔记')).toBeInTheDocument()
  })
})
