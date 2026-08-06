import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { SubdocTabs } from './SubdocTabs'

function node(id: string, parentId: string | null, input: string): NodeRow {
  return {
    ai_response: null, created_at: '', id, is_deleted: 0, model_override: null,
    parent_id: parentId, sort_order: 0, status: 'complete', tree_id: 't',
    updated_at: '', user_input: input,
  }
}

describe('SubdocTabs', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('switches tabs and promotes the active subdocument', () => {
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, ''), node('a', 'root', 'Redis 深入'), node('b', 'root', '内存方案')],
      rootNodeId: 'root', treeId: 't',
    })
    useWorkbench.getState().openSubdocTab('a')
    useWorkbench.getState().openSubdocTab('b')
    render(<ApiProvider api={{} as never}><SubdocTabs /></ApiProvider>)

    fireEvent.click(screen.getByRole('tab', { name: 'Redis 深入' }))
    fireEvent.click(screen.getByLabelText('promote'))
    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })
})
