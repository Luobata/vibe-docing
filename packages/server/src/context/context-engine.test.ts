import type { ContextSegmentRow, NodeRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { createContextEngine } from './context-engine'

describe('ContextEngine', () => {
  it('exposes the assembled provider message sequence', () => {
    const current: NodeRow = {
      ai_response: null,
      created_at: '2026-08-05T00:00:00.000Z',
      id: 'current',
      is_deleted: 0,
      model_override: null,
      parent_id: null,
      sort_order: 0,
      status: 'draft',
      tree_id: 'tree-1',
      updated_at: '2026-08-05T00:00:00.000Z',
      user_input: null,
    }
    const written: ContextSegmentRow[] = []
    const engine = createContextEngine({
      nodes: {
        get: () => current,
        getPathToRoot: () => [current],
      },
      segments: {
        add(input) {
          const row = {
            content: input.content ?? null,
            id: 'segment-1',
            node_id: input.nodeId,
            ref_node_id: input.refNodeId ?? null,
            ref_version_no: input.refVersionNo ?? null,
            seq: input.seq,
            type: input.type,
          }
          written.push(row)
          return row
        },
        listByNode: () => written,
      },
      versions: { get: () => undefined },
    })

    expect(engine.assemble('current', 'hello')).toEqual([
      { content: 'hello', role: 'user' },
    ])
  })
})
