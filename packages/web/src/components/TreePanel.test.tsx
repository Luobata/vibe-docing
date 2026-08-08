import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Breadcrumb } from './Breadcrumb'
import { TreePanel } from './TreePanel'

function node(id: string, parentId: string | null, input: string | null): NodeRow {
  return {
    ai_response: null,
    created_at: '',
    id,
    is_deleted: 0,
    model_override: null,
    parent_id: parentId,
    sort_order: 0,
    status: 'complete',
    tree_id: 't',
    updated_at: '',
    user_input: input,
  }
}

describe('tree and breadcrumb navigation', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })

  it('renders the nested tree and switches the main document', () => {
    render(<TreePanel />)

    fireEvent.click(screen.getByRole('button', { name: '缓存问题' }))

    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })

  it('renders a clickable breadcrumb and drives back/forward controls', () => {
    useWorkbench.getState().setMain('a')
    render(<Breadcrumb />)

    expect(screen.getByLabelText('面包屑')).toHaveTextContent('根缓存问题')
    fireEvent.click(screen.getByRole('button', { name: '根' }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    fireEvent.click(screen.getByRole('button', { name: '后退' }))
    expect(useWorkbench.getState().mainNodeId).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
  })
})

describe('tree node deletion', () => {
  const confirmSpy = vi.spyOn(window, 'confirm')
  beforeEach(() => {
    confirmSpy.mockReset()
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题'), node('b', 'a', '子问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => useWorkbench.getState().reset())

  it('shows a delete control on the root node', () => {
    const api = { deleteNode: vi.fn(), getNode: vi.fn(() => new Promise(() => {})) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)
    // root ('根') now has a delete button (deletes the whole tree)
    expect(screen.getByRole('button', { name: '删除“根”' })).toBeInTheDocument()
  })

  it('deletes a non-root subtree after confirming the cascade count, then offers undo', async () => {
    confirmSpy.mockReturnValue(true)
    const restoreNode = vi.fn(async () => ({ ok: true }))
    const api = {
      deleteNode: vi.fn(async () => ({ ok: true })),
      getNode: vi.fn(() => new Promise(() => {})),
      restoreNode,
    }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)

    // delete node 'a' (which has 1 child 'b') → confirm mentions 2 nodes
    fireEvent.click(screen.getByRole('button', { name: '删除“缓存问题”' }))
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('2'))
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('a'))
    // subtree gone from the tree view
    await waitFor(() => expect(screen.queryByRole('button', { name: '缓存问题' })).toBeNull())

    // an undo affordance appears; clicking it restores
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() => expect(restoreNode).toHaveBeenCalledWith('a'))
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
  })

  it('does not delete when the confirm is cancelled', () => {
    confirmSpy.mockReturnValue(false)
    const api = { deleteNode: vi.fn(), getNode: vi.fn(() => new Promise(() => {})) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '删除“缓存问题”' }))
    expect(api.deleteNode).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
  })
})

describe('root node deletion', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    useWorkbench.getState().reset()
    vi.restoreAllMocks()
  })

  it('root delete button triggers deleteTree on the whole tree', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = { deleteTree: vi.fn().mockResolvedValue({ ok: true }) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByLabelText('删除“根”'))

    await waitFor(() => expect(api.deleteTree).toHaveBeenCalledWith('t'))
  })
})
