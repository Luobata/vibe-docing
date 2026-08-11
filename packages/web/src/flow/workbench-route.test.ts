import type { NodeRow } from '@vibe/shared'
import { render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../api/client'
import { useWorkbench } from '../state/workbench-store'
import { parseWorkbenchRoute, serializeWorkbenchRoute, useWorkbenchRoute } from './workbench-route'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  useWorkbench.getState().reset()
})

describe('workbench route', () => {
  it('round-trips tree, main document, subdocument and panel', () => {
    const url = serializeWorkbenchRoute({
      nodeId: 'main/一', panel: 'notes', subdocId: 'child-2', treeId: 'tree-1', view: 'document',
    })
    expect(url).toBe('/trees/tree-1/documents/main%2F%E4%B8%80?subdoc=child-2&panel=notes')
    expect(parseWorkbenchRoute(new URL(`http://localhost${url}`))).toEqual({
      nodeId: 'main/一', panel: 'notes', subdocId: 'child-2', treeId: 'tree-1', view: 'document',
    })
  })

  it('gives the recycle bin an independent route', () => {
    expect(serializeWorkbenchRoute({ nodeId: null, panel: 'derivations', subdocId: null, treeId: 'tree-1', view: 'trash' })).toBe('/trash/tree-1')
    expect(parseWorkbenchRoute(new URL('http://localhost/trash/tree-1')).view).toBe('trash')
  })

  it('hydrates the exact tree hierarchy from the URL after refresh', async () => {
    const root = { id: 'root', parent_id: null, is_deleted: 0, sort_order: 0, status: 'complete', tree_id: 'tree-1' } as NodeRow
    const child = { ...root, id: 'child', parent_id: 'root' }
    const api = {
      getTree: vi.fn(async () => ({ nodes: [root, child], tree: { id: 'tree-1', root_node_id: 'root' } })),
    } as unknown as Api
    window.history.replaceState({}, '', '/trees/tree-1/documents/root?subdoc=child&panel=notes')
    function Harness() { useWorkbenchRoute(api); return null }
    render(createElement(Harness))

    await waitFor(() => expect(useWorkbench.getState().treeId).toBe('tree-1'))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    expect(useWorkbench.getState().activeSubdocId).toBe('child')
    expect(useWorkbench.getState().subdocPanelTab).toBe('notes')
  })
})
