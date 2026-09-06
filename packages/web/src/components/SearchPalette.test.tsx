import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { SearchPalette } from './SearchPalette'

function node(id: string, parentId: string | null, input: string | null, filePath: string | null = null): NodeRow {
  return {
    ai_response: null, created_at: '', file_path: filePath, id, is_deleted: 0,
    model_override: null, parent_id: parentId, sort_order: 0, status: 'complete',
    tree_id: 't', updated_at: '', user_input: input,
  }
}

const hit = {
  nodeId: 'n1', snippet: '…缓存击穿发生在热点 key 失效时…', title: '缓存问题', treeId: 't', treeTitle: '后端笔记',
}

function renderPalette(api: Record<string, unknown>, onClose = vi.fn()) {
  render(<ApiProvider api={api as never}><SearchPalette onClose={onClose} /></ApiProvider>)
  return onClose
}

describe('SearchPalette', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('n1', 'root', '缓存问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    useWorkbench.getState().reset()
  })

  it('renders a modal dialog with an autofocused input and closes on Escape', () => {
    const onClose = renderPalette({ search: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: '搜索笔记' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('搜索全部笔记库')).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('debounces the query by 250ms and renders title, tree badge and snippet', async () => {
    const search = vi.fn(async () => ({ hits: [hit] }))
    renderPalette({ search })
    fireEvent.change(screen.getByLabelText('搜索全部笔记库'), { target: { value: '缓存' } })
    expect(search).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(search).toHaveBeenCalledWith('缓存', expect.any(AbortSignal))
    const option = await screen.findByRole('option', { name: /缓存问题/ })
    expect(option).toHaveTextContent('后端笔记')
    expect(option).toHaveTextContent('缓存击穿')
  })

  it('does not request below two characters and shows the hint', async () => {
    const search = vi.fn(async () => ({ hits: [] }))
    renderPalette({ search })
    fireEvent.change(screen.getByLabelText('搜索全部笔记库'), { target: { value: '缓' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(search).not.toHaveBeenCalled()
    expect(screen.getByText('至少输入 2 个字符')).toBeInTheDocument()
  })

  it('selects results with arrow keys and Enter opens a same-tree hit in place', async () => {
    const hits = [hit, { ...hit, nodeId: 'n2', title: '索引设计' }]
    const search = vi.fn(async () => ({ hits }))
    const onClose = renderPalette({ search, getTree: vi.fn() })
    fireEvent.change(screen.getByLabelText('搜索全部笔记库'), { target: { value: '缓存' } })
    await act(() => vi.advanceTimersByTimeAsync(250))
    await screen.findByRole('option', { name: /缓存问题/ })

    const input = screen.getByLabelText('搜索全部笔记库')
    const dialog = screen.getByRole('dialog', { name: '搜索笔记' })
    expect(input).toHaveAttribute('aria-activedescendant', 'search-hit-0')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', 'search-hit-1')
    expect(screen.getByRole('option', { name: /索引设计/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() => expect(useWorkbench.getState().mainNodeId).toBe('n1'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', async () => {
    const search = vi.fn(async () => ({ hits: [] }))
    renderPalette({ search })
    fireEvent.change(screen.getByLabelText('搜索全部笔记库'), { target: { value: '不存在' } })
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(await screen.findByText(/没有匹配「不存在」的笔记/)).toBeInTheDocument()
  })

  it('switches trees via getTree + loadTree before jumping to a cross-tree hit', async () => {
    const search = vi.fn(async () => ({ hits: [{ ...hit, treeId: 't2', nodeId: 'x1' }] }))
    const remoteNodes = [node('r2', null, null), node('x1', 'r2', '远端笔记')]
    const getTree = vi.fn(async () => ({
      annotations: [], merges: [], nodes: remoteNodes,
      tree: { created_at: '', id: 't2', is_deleted: 0 as const, root_node_id: 'r2', title: '远端库', updated_at: '' },
    }))
    const onClose = renderPalette({ search, getTree })
    fireEvent.change(screen.getByLabelText('搜索全部笔记库'), { target: { value: '缓存' } })
    await act(() => vi.advanceTimersByTimeAsync(250))
    fireEvent.click(await screen.findByRole('option', { name: /缓存问题/ }))
    await waitFor(() => expect(useWorkbench.getState().treeId).toBe('t2'))
    expect(useWorkbench.getState().mainNodeId).toBe('x1')
    expect(getTree).toHaveBeenCalledWith('t2')
    expect(onClose).toHaveBeenCalled()
  })
})
