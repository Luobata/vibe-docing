import type { AnnotationRow, NodeRow, NodeVersionRow } from '@vibe/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RouteConvergence } from '../api/types'
import { computeChildTabs, useWorkbench } from './workbench-store'

function node(id: string, parentId: string | null, sortOrder = 0): NodeRow {
  return {
    ai_response: null,
    created_at: '',
    id,
    is_deleted: 0,
    model_override: null,
    parent_id: parentId,
    sort_order: sortOrder,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '',
    user_input: id,
  }
}

describe('workbench store', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('loads tree, derives path/tabs, and exposes stable column roles', () => {
    const nodes = [node('root', null), node('a', 'root', 1), node('b', 'root', 0)]

    useWorkbench.getState().loadTree({
      nodes,
      rootNodeId: 'root',
      treeId: 'tree-1',
    })

    expect(useWorkbench.getState().mainNodeId).toBe('root')
    expect(useWorkbench.getState().mainPath).toEqual(['root'])
    expect(computeChildTabs(useWorkbench.getState().nodesById, 'root')).toEqual([
      'b',
      'a',
    ])
    expect(useWorkbench.getState().panelRoles).toEqual({
      main: 'main-document',
      subdoc: 'child-document',
      tree: 'tree-navigation',
    })
  })

  it('promotes a child, rebuilds child tabs, and supports back/forward', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('a', 'root'), node('leaf', 'a')],
      rootNodeId: 'root',
      treeId: 'tree-1',
    })

    useWorkbench.getState().promoteSubdoc('a')
    expect(useWorkbench.getState().mainNodeId).toBe('a')
    expect(useWorkbench.getState().mainPath).toEqual(['root', 'a'])
    expect(useWorkbench.getState().subdocTabs).toEqual(['leaf'])
    useWorkbench.getState().goBack()
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    useWorkbench.getState().goForward()
    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })

  it('tracks route states, versions, trash, and focus without auto-promoting migrations', () => {
    const root = node('root', null)
    const answer = node('answer', 'root')
    useWorkbench.getState().loadTree({
      nodes: [root, answer],
      rootNodeId: root.id,
      treeId: 'tree-1',
    })
    const route: RouteConvergence = {
      candidates: [],
      fallback: {
        label: '主文档',
        refId: null,
        score: 1,
        target: 'main-continuation',
      },
      state: 'failed',
      thresholds: { highConfidence: 0.7, leadMargin: 0.2 },
    }
    const version = {
      ai_response: null,
      change_kind: 'edit',
      created_at: '',
      id: 'v1',
      node_id: answer.id,
      user_input: null,
      version_no: 1,
    } satisfies NodeVersionRow

    useWorkbench.getState().setRouteState(answer.id, route)
    useWorkbench.getState().setVersions(answer.id, [version])
    useWorkbench.getState().setTrash([node('deleted', null)])
    useWorkbench.getState().toggleFocus()
    useWorkbench.getState().upsertNode({ ...answer, parent_id: 'new-parent' })

    expect(useWorkbench.getState().routeByNodeId[answer.id].state).toBe('failed')
    expect(useWorkbench.getState().versionsByNodeId[answer.id]).toEqual([version])
    expect(useWorkbench.getState().trash).toHaveLength(1)
    expect(useWorkbench.getState().focusMode).toBe(true)
    expect(useWorkbench.getState().mainNodeId).toBe(root.id)
  })

  it('persists per-node merge state across reads', () => {
    const store = useWorkbench.getState()
    store.setMergeState('node-a', 'merging')
    expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBe('merging')
    store.setMergeState('node-a', 'merged')
    expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBe('merged')
    store.setMergeState('node-a', null)
    expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBeUndefined()
  })

  it('tracks focused annotation for note jump', () => {
    useWorkbench.getState().setFocusedAnnotation('ann-1')
    expect(useWorkbench.getState().focusedAnnotationId).toBe('ann-1')
    useWorkbench.getState().setFocusedAnnotation(null)
    expect(useWorkbench.getState().focusedAnnotationId).toBeNull()
  })

  it('replaces notesForMain with the provided rows', () => {
    const note = (id: string): AnnotationRow => ({
      anchor_from: 0,
      anchor_to: 3,
      child_node_id: null,
      created_at: '',
      id,
      kind: 'selection',
      node_id: 'n1',
      note: id,
      quoted_text: '片段',
    })

    expect(useWorkbench.getState().notesForMain).toEqual([])
    useWorkbench.getState().setNotesForMain([note('a1'), note('a2')])
    expect(useWorkbench.getState().notesForMain.map((n) => n.id)).toEqual(['a1', 'a2'])
    useWorkbench.getState().setNotesForMain([note('a3')])
    expect(useWorkbench.getState().notesForMain.map((n) => n.id)).toEqual(['a3'])
  })
})
