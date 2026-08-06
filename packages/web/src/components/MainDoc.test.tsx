import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { MainDoc } from './MainDoc'

function node(id: string, parentId: string | null): NodeRow {
  return {
    ai_response: JSON.stringify({ content: [{ content: [{ text: '讲了 Redis 和内存', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
    created_at: '', id, is_deleted: 0, model_override: null, parent_id: parentId,
    sort_order: 0, status: 'complete', tree_id: 't', updated_at: '', user_input: 'Q',
  }
}

describe('MainDoc fork flow', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('forks the selected text and opens the returned child tab', async () => {
    const root = node('root', null)
    const child = { ...node('child', 'root'), user_input: '深入' }
    const api = {
      fork: vi.fn(async () => ({ annotation: { id: 'ann1' }, childNode: child })),
      getNode: vi.fn(async () => ({ annotations: [], node: root, segments: [] })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const view = screen.getByTestId('doc-view')
    const range = document.createRange()
    range.selectNodeContents(view)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.mouseUp(view)
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))

    await waitFor(() => {
      expect(api.fork).toHaveBeenCalledWith('root', expect.objectContaining({
        kind: 'selection', seedText: '深入', treeId: 't',
      }))
      expect(useWorkbench.getState().subdocTabs).toContain('child')
    })
  })

  it('streams an optimistic answer, applies four-state routing, and migrates without auto-promoting', async () => {
    const root = node('root', null)
    const subdoc = { ...node('subdoc', 'root'), user_input: 'Redis 深入' }
    const answer = { ...node('answer', 'root'), user_input: '持久化怎么配？' }
    const moved = { ...answer, parent_id: 'subdoc' }
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      migrate: vi.fn(async () => ({ node: moved, path: [root, subdoc, moved] })),
      route: vi.fn(async () => ({
        candidates: [{ label: 'Redis 深入', refId: 'subdoc', score: 0.91, target: 'bound-subdoc' }],
        chosen: { label: 'Redis 深入', refId: 'subdoc', score: 0.91, target: 'bound-subdoc' },
        fallback: { label: '主文档', refId: null, score: 1, target: 'main-continuation' },
        state: 'high-confidence-elsewhere',
        thresholds: { highConfidence: 0.7, leadMargin: 0.2 },
      })),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onChunk(text: string): void
        onDone(result: NodeRow): void
      }) => {
        handlers.onChunk('回答')
        handlers.onDone({ ...answer, ai_response: JSON.stringify({ content: [{ content: [{ text: '回答', type: 'text' }], type: 'paragraph' }], type: 'doc' }) })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root, subdoc], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '持久化怎么配？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('回答')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '搬过去' }))
    await waitFor(() => expect(api.migrate).toHaveBeenCalledWith('answer', {
      newParentId: 'subdoc', seedText: '持久化怎么配？', target: 'bound-subdoc',
    }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    expect(await screen.findByRole('button', { name: '查看迁移位置' })).toBeInTheDocument()
  })
})
