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
    render(<NotesTab annotations={[ann({}), ann({ id: 'a2', child_node_id: 'c1', note: null })]} onJump={onJump} onCreateNote={() => {}} />)
    expect(screen.getByText('待验证')).toBeInTheDocument()
    fireEvent.click(screen.getByText('待验证'))
    expect(onJump).toHaveBeenCalledWith('a1')
  })
  it('shows empty state when no notes', () => {
    render(<NotesTab annotations={[]} onJump={() => {}} onCreateNote={() => {}} />)
    expect(screen.getByText('还没有笔记')).toBeInTheDocument()
  })
})

describe('NotesTab create', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  it('submits a new note on Enter and clears', () => {
    const onCreateNote = vi.fn()
    render(<NotesTab annotations={[]} onJump={() => {}} onCreateNote={onCreateNote} />)
    const input = screen.getByLabelText('new-note-input')
    fireEvent.change(input, { target: { value: '一条新笔记' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateNote).toHaveBeenCalledWith('一条新笔记')
    expect(input).toHaveValue('')
  })
})

describe('NotesTab anchor highlight', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  it('flashes the anchored note and clears anchoredNoteId', () => {
    useWorkbench.getState().setAnchoredNoteId('a1')
    render(<NotesTab annotations={[ann({})]} onJump={() => {}} onCreateNote={() => {}} />)
    const item = screen.getByText('待验证').closest('.note-item')
    expect(item).toHaveClass('ann-flash')
    expect(useWorkbench.getState().anchoredNoteId).toBeNull()
  })
})
