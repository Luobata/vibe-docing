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

  it('focus mode collapses both side panels via class while the main doc stays visible', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '进入沉浸聚焦' }))

    expect(screen.getByTestId('workbench')).toHaveAttribute('data-focus', 'true')
    expect(screen.getByTestId('tree-panel')).toHaveClass('is-collapsed')
    expect(screen.getByTestId('subdoc-panel')).toHaveClass('is-collapsed')
    expect(screen.getByTestId('main-doc')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('tree-panel')).not.toHaveClass('is-collapsed')
    expect(screen.getByTestId('subdoc-panel')).not.toHaveClass('is-collapsed')
  })

  it('focus mode hides side panels via class (animatable), not hidden attribute', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: /沉浸聚焦/ }))

    const tree = screen.getByTestId('tree-panel')
    expect(tree.hasAttribute('hidden')).toBe(false)
    expect(tree.className).toMatch(/is-collapsed/)
    expect(tree).toHaveAttribute('aria-hidden', 'true')
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
