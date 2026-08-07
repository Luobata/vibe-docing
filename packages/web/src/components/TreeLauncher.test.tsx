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

  it('deletes a tree from the list after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = {
      deleteTree: vi.fn(async () => ({ ok: true })),
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '要删的树' }] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '要删的树' })
    fireEvent.click(screen.getByRole('button', { name: '删除“要删的树”' }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(api.deleteTree).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '要删的树' })).toBeNull())
    confirmSpy.mockRestore()
  })

  it('renames a tree inline', async () => {
    const api = {
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '旧名' }] })),
      renameTree: vi.fn(async () => ({ tree: { id: 't1', root_node_id: 'root', title: '新名' } })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '旧名' })
    fireEvent.click(screen.getByRole('button', { name: '重命名“旧名”' }))
    const editor = screen.getByLabelText('rename-tree-input')
    fireEvent.change(editor, { target: { value: '新名' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(api.renameTree).toHaveBeenCalledWith('t1', '新名'))
    expect(await screen.findByRole('button', { name: '新名' })).toBeInTheDocument()
  })

  it('hints why 新建树 is disabled when the title is empty', () => {
    const api = { listTrees: vi.fn(async () => ({ trees: [] })) }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const button = screen.getByRole('button', { name: '新建树' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '请先输入标题')
  })

  it('does not create on Enter during IME composition or when the title is empty', async () => {
    const api = {
      createTree: vi.fn(async () => ({ rootNode: root, tree: { id: 't1', title: '缓存' } })),
      listTrees: vi.fn(async () => ({ trees: [] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const input = screen.getByLabelText('new-tree-title')

    // Enter with no title → no create
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.createTree).not.toHaveBeenCalled()

    // Enter while IME is composing (confirming a Pinyin candidate) → no create
    fireEvent.change(input, { target: { value: '缓存' } })
    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' })
    expect(api.createTree).not.toHaveBeenCalled()

    // Plain Enter with a title → creates once
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.createTree).toHaveBeenCalledWith('缓存'))
    expect(api.createTree).toHaveBeenCalledOnce()
  })
})
