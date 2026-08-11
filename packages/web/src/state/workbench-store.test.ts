import type { AnnotationRow, NodeRow, NodeVersionRow } from '@vibe/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteConvergence } from '../api/types'
import {
  computeChildTabs,
  generationTaskKeys,
  generationTaskRegistry,
  useWorkbench,
} from './workbench-store'

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

  it('marks a background completion unread and clears it when opened', () => {
    const child = { ...node('a', 'root'), status: 'streaming' as const }
    useWorkbench.getState().loadTree({ nodes: [node('root', null), child], rootNodeId: 'root', treeId: 'tree-1' })
    useWorkbench.getState().upsertNode({ ...child, status: 'complete' })
    expect(useWorkbench.getState().unreadNodeIds).toContain('a')
    useWorkbench.getState().setActiveSubdoc('a')
    expect(useWorkbench.getState().unreadNodeIds).not.toContain('a')
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

  it('tracks subdoc panel tab and one-shot note/subdocument anchors', () => {
    const s = useWorkbench.getState()
    expect(useWorkbench.getState().subdocPanelTab).toBe('derivations')
    s.setSubdocPanelTab('notes')
    expect(useWorkbench.getState().subdocPanelTab).toBe('notes')
    s.setAnchoredNoteId('ann-9')
    expect(useWorkbench.getState().anchoredNoteId).toBe('ann-9')
    s.setAnchoredNoteId(null)
    expect(useWorkbench.getState().anchoredNoteId).toBeNull()
    s.setAnchoredSubdocId('child-2')
    expect(useWorkbench.getState().anchoredSubdocId).toBe('child-2')
    s.setAnchoredSubdocId(null)
    expect(useWorkbench.getState().anchoredSubdocId).toBeNull()
  })

  it('bumps the merge refresh tick so listeners can re-fetch', () => {
    expect(useWorkbench.getState().mergeRefreshTick).toBe(0)
    useWorkbench.getState().bumpMergeRefresh()
    expect(useWorkbench.getState().mergeRefreshTick).toBe(1)
    useWorkbench.getState().bumpMergeRefresh()
    expect(useWorkbench.getState().mergeRefreshTick).toBe(2)
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

  it('runs different selection keys concurrently and rejects only duplicate key or target', () => {
    const firstKey = generationTaskKeys.forkExpand('root', 0, 5)
    const secondKey = generationTaskKeys.forkExpand('root', 6, 12)
    const first = generationTaskRegistry.start({
      key: firstKey,
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })
    const second = generationTaskRegistry.start({
      key: secondKey,
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.controller).not.toBe(second?.controller)
    expect(generationTaskRegistry.start({
      key: firstKey,
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })).toBeNull()

    expect(first && generationTaskRegistry.setTarget(first, 'child-a')).toBe(true)
    expect(generationTaskRegistry.start({
      key: generationTaskKeys.retry('child-a'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'child-a',
    })).toBeNull()
  })

  it('stops and settles one task without affecting another task', () => {
    const first = generationTaskRegistry.start({
      key: generationTaskKeys.retry('a'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'a',
    })!
    const second = generationTaskRegistry.start({
      key: generationTaskKeys.retry('b'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'b',
    })!

    expect(generationTaskRegistry.stop(first.key)).toBe(true)
    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(false)
    expect(generationTaskRegistry.getSnapshot().byKey[first.key].phase).toBe('stopping')
    expect(generationTaskRegistry.settle(first, 'cancelled')).toBe(true)
    expect(generationTaskRegistry.getSnapshot().byKey[first.key].status).toBe('cancelled')
    expect(generationTaskRegistry.isTaskLive(second)).toBe(true)
  })

  it('settles a stopped task through its own two-second fallback', () => {
    vi.useFakeTimers()
    try {
      const onCancelled = vi.fn()
      const task = generationTaskRegistry.start({
        key: generationTaskKeys.retry('fallback'),
        kind: 'retry',
        onCancelled,
        ownerMainNodeId: 'root',
        targetNodeId: 'fallback',
      })!

      generationTaskRegistry.stop(task.key)
      expect(generationTaskRegistry.getSnapshot().byKey[task.key].phase).toBe('stopping')
      vi.advanceTimersByTime(1999)
      expect(generationTaskRegistry.getSnapshot().byKey[task.key].status).toBe('streaming')
      vi.advanceTimersByTime(1)
      expect(generationTaskRegistry.getSnapshot().byKey[task.key].status).toBe('cancelled')
      expect(onCancelled).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('isolates task failures and keeps isTaskLive independent from the visible main node', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('other', 'root')],
      rootNodeId: 'root',
      treeId: 'tree-1',
    })
    const failed = generationTaskRegistry.start({
      key: generationTaskKeys.retry('root'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'root',
    })!
    const background = generationTaskRegistry.start({
      key: generationTaskKeys.retry('other'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'other',
    })!

    useWorkbench.getState().setMain('other')
    expect(generationTaskRegistry.isTaskLive(background)).toBe(true)
    generationTaskRegistry.settle(failed, 'error', 'only root failed')
    expect(generationTaskRegistry.getSnapshot().byKey[failed.key].error).toBe('only root failed')
    expect(generationTaskRegistry.isTaskLive(background)).toBe(true)
  })

  it('aborts and clears every registered task when a tree is loaded or reset', () => {
    const first = generationTaskRegistry.start({
      key: generationTaskKeys.ask('root'),
      kind: 'ask',
      ownerMainNodeId: 'root',
    })!
    const second = generationTaskRegistry.start({
      key: generationTaskKeys.retry('child'),
      kind: 'retry',
      ownerMainNodeId: 'root',
      targetNodeId: 'child',
    })!

    useWorkbench.getState().loadTree({
      nodes: [node('next-root', null)],
      rootNodeId: 'next-root',
      treeId: 'tree-2',
    })
    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(true)
    expect(generationTaskRegistry.getSnapshot()).toEqual({ byKey: {}, byTarget: {} })

    const afterLoad = generationTaskRegistry.start({
      key: generationTaskKeys.ask('next-root'),
      kind: 'ask',
      ownerMainNodeId: 'next-root',
    })!
    useWorkbench.getState().reset()
    expect(afterLoad.controller.signal.aborted).toBe(true)
    expect(generationTaskRegistry.getSnapshot()).toEqual({ byKey: {}, byTarget: {} })
  })
})
