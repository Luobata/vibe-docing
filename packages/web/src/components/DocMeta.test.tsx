import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { DocMeta } from './DocMeta'

function node(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    ai_response: null,
    created_at: '2026-08-20T08:00:00.000Z',
    id: 'n1',
    is_deleted: 0,
    model_override: null,
    parent_id: 'root',
    sort_order: 0,
    status: 'complete',
    tree_id: 't',
    updated_at: '2026-08-22T08:00:00.000Z',
    user_input: '缓存问题',
    ...overrides,
  }
}

function setup(target: NodeRow, api: Record<string, unknown> = {}) {
  useWorkbench.getState().reset()
  useWorkbench.getState().loadTree({
    nodes: [node({ id: 'root', parent_id: null, user_input: null }), target],
    rootNodeId: 'root',
    treeId: 't',
  })
  render(<ApiProvider api={api as never}><DocMeta node={target} /></ApiProvider>)
}

describe('DocMeta', () => {
  beforeEach(() => useWorkbench.getState().reset())
  afterEach(() => useWorkbench.getState().reset())

  it('shows relative created/updated times with full timestamps in the tooltip', () => {
    setup(node())
    const time = document.querySelector('.doc-meta-time')
    expect(time).toHaveTextContent('创建于')
    expect(time).toHaveTextContent('更新于')
    expect(time).toHaveAttribute('title', '创建于 2026-08-20T08:00:00.000Z · 更新于 2026-08-22T08:00:00.000Z')
  })

  it('renders tag chips from tags_json', () => {
    setup(node({ tags_json: '["缓存","Redis"]' }))
    expect(screen.getByText('缓存')).toBeInTheDocument()
    expect(screen.getByText('Redis')).toBeInTheDocument()
  })

  it('adds a tag via the inline input with IME guard', async () => {
    const updateNodeTags = vi.fn(async (_id: string, tags: string[]) => ({
      node: node({ tags_json: JSON.stringify(tags) }),
    }))
    setup(node({ tags_json: '["缓存"]' }), { updateNodeTags })
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }))
    const input = screen.getByLabelText('新标签名')
    fireEvent.change(input, { target: { value: '分布式' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(updateNodeTags).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(updateNodeTags).toHaveBeenCalledWith('n1', ['缓存', '分布式']))
    await waitFor(() => expect(screen.getByText('分布式')).toBeInTheDocument())
  })

  it('removes a tag optimistically and rolls back with a toast on failure', async () => {
    const updateNodeTags = vi.fn(async () => { throw new Error('HTTP 500') })
    setup(node({ tags_json: '["缓存","Redis"]' }), { updateNodeTags })
    fireEvent.click(screen.getByRole('button', { name: '删除标签“Redis”' }))
    // 乐观更新：chip 立即消失
    expect(screen.queryByText('Redis')).toBeNull()
    await waitFor(() => expect(updateNodeTags).toHaveBeenCalledWith('n1', ['缓存']))
    // 失败回滚 + toast
    await waitFor(() => expect(screen.getByText('Redis')).toBeInTheDocument())
    await waitFor(() => expect(useWorkbench.getState().toast).toBeTruthy())
  })

  it('disables editing while streaming and shows a pending placeholder', () => {
    setup(node({ status: 'streaming', tags_json: null }))
    expect(screen.getByText('标签生成中…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加标签' })).toBeNull()
  })
})
