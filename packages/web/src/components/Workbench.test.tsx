import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('switches the mobile tablist without unmounting any panel', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const tabs = within(screen.getByRole('tablist', { name: '工作区面板' }))
    const tree = screen.getByTestId('tree-panel')
    const main = screen.getByTestId('main-doc')
    const subdoc = screen.getByTestId('subdoc-panel')

    fireEvent.click(tabs.getByRole('tab', { name: '树' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'tree')
    fireEvent.click(tabs.getByRole('tab', { name: '子文档' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'subdoc')
    expect(screen.getByTestId('tree-panel')).toBe(tree)
    expect(screen.getByTestId('main-doc')).toBe(main)
    expect(screen.getByTestId('subdoc-panel')).toBe(subdoc)
  })

  it('returns to the document panel after selecting a tree node', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const tabs = within(screen.getByRole('tablist', { name: '工作区面板' }))
    fireEvent.click(tabs.getByRole('tab', { name: '树' }))
    fireEvent.click(screen.getByRole('button', { name: 'child' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'main')
  })

  it('offers keyboard navigation for child tabs beyond the first six', () => {
    const children = Array.from({ length: 8 }, (_, index) => ({
      ...node(`child-${index + 1}`, 'root'),
      sort_order: index,
      user_input: `第 ${index + 1} 个很长的派生分支标题`,
    }))
    act(() => useWorkbench.getState().loadTree({ nodes: [node('root', null), ...children], rootNodeId: 'root', treeId: 'many' }))
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '更多 (2)' }))
    const listbox = screen.getByRole('listbox', { name: '更多子文档' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(useWorkbench.getState().activeSubdocId).toBe('child-8')
  })

  it('remounts the tree panel when switching trees so local errors cannot leak', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const firstTreeNav = screen.getByRole('navigation', { name: '文档树' })
    act(() => useWorkbench.getState().loadTree({ nodes: [node('other-root', null)], rootNodeId: 'other-root', treeId: 'other-tree' }))
    expect(screen.getByRole('navigation', { name: '文档树' })).not.toBe(firstTreeNav)
  })
})
