import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { TreeLauncher } from './TreeLauncher'

const root = {
  ai_response: null, created_at: '', id: 'root', is_deleted: 0, model_override: null,
  parent_id: null, sort_order: 0, status: 'draft', tree_id: 't1', updated_at: '', user_input: null,
} satisfies NodeRow

describe('TreeLauncher', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('creates and loads a new tree', async () => {
    const api = {
      createTree: vi.fn(async () => ({ rootNode: root, tree: { id: 't1', title: '缓存' } })),
      listTrees: vi.fn(async () => ({ trees: [] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('new-tree-title'), { target: { value: '缓存' } })
    fireEvent.click(screen.getByRole('button', { name: '新建树' }))
    await waitFor(() => expect(useWorkbench.getState().mainNodeId).toBe('root'))
    expect(api.createTree).toHaveBeenCalledWith('缓存')
  })

  it('opens an existing tree through getTree', async () => {
    const api = {
      getTree: vi.fn(async () => ({ nodes: [root], tree: { id: 't1', root_node_id: 'root', title: '已有树' } })),
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '已有树' }] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '已有树' }))
    await waitFor(() => expect(api.getTree).toHaveBeenCalledWith('t1'))
    expect(useWorkbench.getState().treeId).toBe('t1')
  })

  it('hints why 新建树 is disabled when the title is empty', () => {
    const api = { listTrees: vi.fn(async () => ({ trees: [] })) }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const button = screen.getByRole('button', { name: '新建树' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '请先输入标题')
  })
})
