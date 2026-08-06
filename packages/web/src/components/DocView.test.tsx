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
  it('renders ProseMirror text, preserves line breaks, and marks annotations', () => {
    render(<DocView annotations={[annotation()]} node={node()} onRetry={() => {}} onSelect={() => {}} />)

    expect(screen.getByTestId('doc-view')).toHaveTextContent('第一段 第二段')
    expect(screen.getByTestId('doc-view')).toHaveStyle({ whiteSpace: 'pre-wrap' })
    expect(screen.getByText('第一段').closest('mark')).toHaveAttribute('data-ann-id', 'ann-1')
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
})
