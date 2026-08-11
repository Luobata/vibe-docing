import type { AnnotationRow, NodeRow } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DocView } from './DocView'
import { SelectionMenu } from './SelectionMenu'
import { visualRuntimeStore } from '../visual/visual-stream-state'

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

function SelectionHarness() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <DocView
        annotations={[]}
        node={node()}
        onContextSelect={(_selection, x, y) => setMenu({ x, y })}
        onRetry={() => {}}
        onSelect={() => {}}
      />
      {menu && <SelectionMenu onClose={() => setMenu(null)} onPick={() => {}} x={menu.x} y={menu.y} />}
    </>
  )
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

  it('shows stopped generation state with a regenerate action', () => {
    const onRetry = vi.fn()
    render(
      <DocView
        annotations={[]}
        node={node('cancelled')}
        onRetry={onRetry}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByText('已停止生成')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
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

  it('renders a persisted visual reference and exposes its whole-block note anchor', () => {
    visualRuntimeStore.dispatch({
      type: 'visual_ready', placeholderId: 'p', artifactId: 'visual-1', revision: 1,
      artifact: {
        schemaVersion: 1, artifactId: 'visual-1', revision: 1, kind: 'flow', renderer: 'svg',
        title: '流程图', altText: 'A 到 B', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: [{ id: 'e', source: 'a', target: 'b' }], groups: [],
      },
    })
    const visualNode = {
      ...node(),
      ai_response: JSON.stringify({
        type: 'doc',
        content: [{ type: 'visual_ref', attrs: { artifactId: 'visual-1', revision: 1, altText: 'A 到 B' } }],
      }),
    }
    const visualAnnotation: AnnotationRow = {
      anchor_from: null, anchor_to: null, child_node_id: null, created_at: '', id: 'visual-ann',
      kind: 'whole', node_id: 'n', note: '检查整图', quoted_text: null,
      visual_target: { artifactId: 'visual-1', revision: 1, target: 'whole' },
    }
    const onAnchorClick = vi.fn()
    render(<DocView annotations={[visualAnnotation]} node={visualNode} onAnchorClick={onAnchorClick} onRetry={() => {}} onSelect={() => {}} />)

    expect(screen.getByRole('img', { name: 'A 到 B' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '图批注 1' }))
    expect(onAnchorClick).toHaveBeenCalledWith('visual-ann')
  })

  it('waits for mouseup before showing the selection toolbar without clearing selection', async () => {
    render(<SelectionHarness />)
    const body = document.querySelector<HTMLElement>('.doc-body')!
    const selected = body.querySelector('p')!.firstChild!
    body.focus()
    const range = document.createRange()
    range.setStart(selected, 0)
    range.setEnd(selected, '第一段'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent(document, new Event('selectionchange'))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.mouseUp(body)

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(body).toHaveFocus()
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: '笔记' }))
    expect(window.getSelection()?.toString()).toBe('第一段')
  })
})
