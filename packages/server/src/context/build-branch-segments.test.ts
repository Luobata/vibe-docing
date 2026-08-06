import type { ContextSegmentRow, NodeRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { buildBranchSegments } from './build-branch-segments'

function node(id: string, parentId: string | null, isDeleted: 0 | 1 = 0): NodeRow {
  return {
    ai_response: null,
    created_at: '2026-08-05T00:00:00.000Z',
    id,
    is_deleted: isDeleted,
    model_override: null,
    parent_id: parentId,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '2026-08-05T00:00:00.000Z',
    user_input: id,
  }
}

describe('buildBranchSegments', () => {
  it('writes active ancestors root-to-parent, then the seed with contiguous seq', () => {
    const written: ContextSegmentRow[] = []
    const path = [node('root', null), node('deleted', 'root', 1), node('parent', 'deleted')]

    buildBranchSegments(
      {
        nodes: { getPathToRoot: () => path },
        segments: {
          add(input) {
            const row: ContextSegmentRow = {
              content: input.content ?? null,
              id: `segment-${written.length}`,
              node_id: input.nodeId,
              ref_node_id: input.refNodeId ?? null,
              ref_version_no: input.refVersionNo ?? null,
              seq: input.seq,
              type: input.type,
            }
            written.push(row)
            return row
          },
        },
      },
      { childNodeId: 'child', parentNodeId: 'parent', seedText: '聚焦 Redis' },
    )

    expect(written.map(({ seq, type, ref_node_id, content }) => ({
      content,
      ref_node_id,
      seq,
      type,
    }))).toEqual([
      { content: null, ref_node_id: 'root', seq: 0, type: 'ancestor-full' },
      { content: null, ref_node_id: 'parent', seq: 1, type: 'ancestor-full' },
      { content: '聚焦 Redis', ref_node_id: null, seq: 2, type: 'annotation-seed' },
    ])
    expect(written[0].ref_version_no).toBeNull()
  })
})
