import type { AnnotationRow, NodeRow } from '@vibe/shared'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../api/context'
import { generationTaskRegistry, useWorkbench } from '../state/workbench-store'
import { SubdocPanelTabs } from './SubdocPanelTabs'

function node(id: string, parentId: string | null): NodeRow {
  return {
    ai_response: null,
    created_at: '',
    id,
    is_deleted: 0,
    model_override: null,
    parent_id: parentId,
    sort_order: 0,
    status: parentId ? 'streaming' : 'complete',
    tree_id: 'tree',
    updated_at: '',
    user_input: id,
  }
}

describe('SubdocPanelTabs generation summary', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('counts live branches and keeps one branch failure isolated in DOM hooks', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('a', 'root'), node('b', 'root')],
      rootNodeId: 'root',
      treeId: 'tree',
    })
    const first = generationTaskRegistry.start({
      key: 'fork-expand:root:0:3',
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
      targetNodeId: 'a',
    })!
    const second = generationTaskRegistry.start({
      key: 'fork-expand:root:4:8',
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
      targetNodeId: 'b',
    })!

    render(
      <ApiProvider api={{} as never}>
        <SubdocPanelTabs annotations={[]} canCreateNote={false} onCreateNote={() => {}} />
      </ApiProvider>,
    )

    const summary = screen.getByText('2 个分支生成中')
    expect(summary).toHaveAttribute('data-gen-status', 'streaming')
    expect(summary).toHaveAttribute('data-task-key', `${first.key} ${second.key}`)

    act(() => { generationTaskRegistry.settle(first, 'error', 'only a failed') })
    expect(screen.getByText('1 个分支生成中')).toHaveAttribute('data-task-key', second.key)
    expect(screen.getByRole('tab', { name: /a，生成失败/ })).toHaveAttribute('data-gen-status', 'error')
    expect(screen.getByRole('tab', { name: /b，生成中/ })).toHaveAttribute('data-gen-status', 'streaming')
  })

  it('shows branch and note counts on both tabs', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('a', 'root')], rootNodeId: 'root', treeId: 'tree',
    })
    const note = {
      anchor_from: 0, anchor_to: 1, child_node_id: null, created_at: '', id: 'note-1',
      kind: 'selection', node_id: 'root', note: '记住', quoted_text: '原文',
    } satisfies AnnotationRow
    render(<ApiProvider api={{} as never}><SubdocPanelTabs annotations={[note]} canCreateNote={false} onCreateNote={() => {}} /></ApiProvider>)
    expect(screen.getByRole('tab', { name: /派生分支.*1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /笔记.*1/ })).toBeInTheDocument()
  })
})
