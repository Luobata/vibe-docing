import type { AnnotationRow, NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { generationTaskRegistry, useWorkbench } from '../state/workbench-store'
import { SubdocTabs } from './SubdocTabs'

function node(id: string, parentId: string | null, input: string): NodeRow {
  return {
    ai_response: null, created_at: '', id, is_deleted: 0, model_override: null,
    parent_id: parentId, sort_order: 0, status: 'complete', tree_id: 't',
    updated_at: '', user_input: input,
  }
}

describe('SubdocTabs', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('switches tabs and promotes the active subdocument', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, ''), node('a', 'root', 'Redis 深入'), node('b', 'root', '内存方案')],
      rootNodeId: 'root', treeId: 't',
    })
    useWorkbench.getState().openSubdocTab('a')
    useWorkbench.getState().openSubdocTab('b')
    render(<ApiProvider api={{} as never}><SubdocTabs /></ApiProvider>)

    fireEvent.click(screen.getByRole('tab', { name: /Redis 深入/ }))
    fireEvent.click(screen.getByLabelText('promote'))
    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })

  it('locates the source annotation when a derivation is selected', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, ''), node('a', 'root', 'MemoryScope')],
      rootNodeId: 'root', treeId: 't',
    })
    const source = {
      anchor_from: 4, anchor_to: 15, child_node_id: 'a', created_at: '', id: 'ann-a',
      kind: 'selection', node_id: 'root', note: null, quoted_text: 'MemoryScope',
    } satisfies AnnotationRow
    render(<ApiProvider api={{} as never}><SubdocTabs annotations={[source]} /></ApiProvider>)

    fireEvent.click(screen.getByRole('tab', { name: /MemoryScope/ }))
    expect(useWorkbench.getState().focusedAnnotationId).toBe('ann-a')
    expect(screen.getByRole('button', { name: '定位原文' })).toBeInTheDocument()
  })

  it('scrolls and flashes the source branch after returning from a derived document', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, ''), node('a', 'root', 'MemoryScope')],
      rootNodeId: 'root', treeId: 't',
    })
    useWorkbench.getState().setAnchoredSubdocId('a')
    render(<ApiProvider api={{} as never}><SubdocTabs /></ApiProvider>)

    const tab = screen.getByRole('tab', { name: /MemoryScope/ })
    await waitFor(() => expect(tab).toHaveClass('is-anchor-flash'))
    expect(useWorkbench.getState().activeSubdocId).toBe('a')
    expect(useWorkbench.getState().anchoredSubdocId).toBeNull()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('shows per-branch progress and stops only the active branch', async () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, ''), { ...node('a', 'root', 'Redis 深入'), status: 'streaming' }],
      rootNodeId: 'root', treeId: 't',
    })
    useWorkbench.getState().openSubdocTab('a')
    const key = 'fork-expand:root:0:5'
    const task = generationTaskRegistry.start({
      key,
      kind: 'fork-expand',
      onCancelled() {
        useWorkbench.getState().upsertNode({ ...useWorkbench.getState().nodesById.a, status: 'cancelled' })
      },
      ownerMainNodeId: 'root',
      targetNodeId: 'a',
    })
    const other = generationTaskRegistry.start({
      key: 'fork-expand:root:6:10',
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })

    render(<ApiProvider api={{} as never}><SubdocTabs /></ApiProvider>)

    expect(screen.getByRole('tab', { name: /Redis 深入，生成中/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /停止生成：Redis 深入/ }))
    expect(task?.controller.signal.aborted).toBe(true)
    expect(other?.controller.signal.aborted).toBe(false)
    expect(generationTaskRegistry.getSnapshot().byKey[key]?.phase).toBe('stopping')
    act(() => { if (task) generationTaskRegistry.settle(task, 'cancelled') })
    expect(generationTaskRegistry.getSnapshot().byKey[key]?.status).toBe('cancelled')
    expect(useWorkbench.getState().nodesById.a.status).toBe('cancelled')
    await waitFor(() => expect(screen.getByRole('button', { name: '重新生成' })).toHaveFocus())
  })
})
