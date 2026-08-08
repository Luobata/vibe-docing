import type { AnnotationRow, NodeRow } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocView } from './DocView'

function node(status: NodeRow['status'] = 'complete'): NodeRow {
  return {
    ai_response: JSON.stringify({
      content: [
        { content: [{ text: '第一段', type: 'text' }], type: 'paragraph' },
        { content: [{ text: '第二段', type: 'text' }], type: 'paragraph' },
      ],
      type: 'doc',
    }),
    created_at: '', id: 'n', is_deleted: 0, model_override: null,
    parent_id: null, sort_order: 0, status, tree_id: 't', updated_at: '', user_input: 'Q',
  }
}

function annotation(): AnnotationRow {
  return {
    anchor_from: 0, anchor_to: 3, child_node_id: null, created_at: '', id: 'ann-1',
    kind: 'selection', node_id: 'n', note: null, quoted_text: '第一段',
  }
}

describe('DocView', () => {
  it('renders markdown content and marks annotations', () => {
    render(<DocView annotations={[annotation()]} node={node()} onRetry={() => {}} onSelect={() => {}} />)

    expect(screen.getByTestId('doc-view')).toHaveTextContent('第一段')
    expect(screen.getByTestId('doc-view')).toHaveTextContent('第二段')
    expect(screen.getByText('第一段').closest('mark')).toHaveAttribute('data-ann-id', 'ann-1')
  })

  it('renders markdown structure (headings and bold)', () => {
    const md: NodeRow = {
      ...node(),
      ai_response: JSON.stringify({
        content: [
          { content: [{ text: '### 小标题', type: 'text' }], type: 'paragraph' },
          { content: [{ text: '**重点** 内容', type: 'text' }], type: 'paragraph' },
        ],
        type: 'doc',
      }),
    }
    const { container } = render(<DocView annotations={[]} node={md} onRetry={() => {}} onSelect={() => {}} />)
    expect(container.querySelector('h3')?.textContent).toBe('小标题')
    expect(container.querySelector('strong')?.textContent).toBe('重点')
  })

  it('shows streaming and retry states', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <DocView annotations={[]} node={node('streaming')} onRetry={onRetry} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('正在生成')).toBeInTheDocument()

    rerender(<DocView annotations={[]} node={node('error')} onRetry={onRetry} onSelect={() => {}} />)
    fireEvent.click(screen.getByLabelText('retry'))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows a thinking hint while streaming with no content yet', () => {
    const empty: NodeRow = { ...node('streaming'), ai_response: null, user_input: 'Q' }
    const { rerender } = render(
      <DocView annotations={[]} node={empty} onRetry={() => {}} onSelect={() => {}} />,
    )
    // before any token: blinking cursor + "思考中" hint
    expect(screen.getByLabelText('正在生成')).toBeInTheDocument()
    expect(screen.getByText(/思考中/)).toBeInTheDocument()

    // once content streams in, the hint disappears (cursor stays)
    rerender(<DocView annotations={[]} node={node('streaming')} onRetry={() => {}} onSelect={() => {}} />)
    expect(screen.getByLabelText('正在生成')).toBeInTheDocument()
    expect(screen.queryByText(/思考中/)).toBeNull()
  })

  it('calls onAnchorClick with the mark id when a mark is clicked', () => {
    const onAnchorClick = vi.fn()
    render(<DocView annotations={[annotation()]} node={node()} onAnchorClick={onAnchorClick} onRetry={() => {}} onSelect={() => {}} />)

    const mark = screen.getByText('第一段').closest('mark')!
    expect(mark).toHaveAttribute('data-ann-id', 'ann-1')
    fireEvent.click(mark)
    expect(onAnchorClick).toHaveBeenCalledWith('ann-1')

    onAnchorClick.mockClear()
    fireEvent.click(screen.getByText('第二段'))
    expect(onAnchorClick).not.toHaveBeenCalled()
  })
})
