import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
