import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Workbench } from './Workbench'

function node(id: string, parentId: string | null): NodeRow {
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
    user_input: id,
  }
}

describe('Workbench', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('child', 'root'), node('leaf', 'child')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })

  it('keeps main and subdocument panels visible while focus hides only the tree', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '进入沉浸聚焦' }))

    expect(screen.getByTestId('workbench')).toHaveAttribute('data-focus', 'true')
    expect(screen.getByTestId('tree-panel')).not.toBeVisible()
    expect(screen.getByTestId('main-doc')).toBeVisible()
    expect(screen.getByTestId('subdoc-panel')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('tree-panel')).toBeVisible()
  })

  it('scrolls column roles when the active child is promoted', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    expect(screen.getByTestId('main-doc')).toHaveTextContent('root')
    fireEvent.click(screen.getByLabelText('promote'))

    expect(screen.getByTestId('main-doc')).toHaveTextContent('child')
    expect(screen.getByTestId('subdoc-panel')).toHaveTextContent('leaf')
    expect(useWorkbench.getState().mainPath).toEqual(['root', 'child'])
  })
})
