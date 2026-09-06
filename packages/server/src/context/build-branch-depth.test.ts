import type { ContextSegmentRow, NodeRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { buildBranchSegments } from './build-branch-segments'

function node(id: string, parentId: string | null, isDeleted: 0 | 1 = 0): NodeRow {
  return {
    ai_response: null,
    created_at: '2026-08-05T00:00:00.000Z',
    document_content: null,
    id,
    is_deleted: isDeleted,
    model_override: null,
    parent_id: parentId,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '2026-08-05T00:00:00.000Z',
    user_input: `${id} 的提问\n第二行`,
  }
}

function recorder() {
  const written: ContextSegmentRow[] = []
  return {
    deps: {
      nodes: { getPathToRoot: () => [] as NodeRow[] },
      segments: {
        add(input: { content?: string | null; nodeId: string; refNodeId?: string | null; refVersionNo?: number | null; seq: number; type: ContextSegmentRow['type'] }): ContextSegmentRow {
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
    written,
  }
}

describe('buildBranchSegments ancestor depth policy', () => {
  it('keeps the nearest two ancestors full and summarizes older ones by default', () => {
    const path = [
      node('root', null),
      node('a', 'root'),
      node('b', 'a'),
      node('c', 'b'),
      node('parent', 'c'),
    ]
    const { deps, written } = recorder()
    deps.nodes.getPathToRoot = () => path

    buildBranchSegments(deps, { childNodeId: 'child', parentNodeId: 'parent', seedText: '聚焦' })

    expect(written.map(({ type, ref_node_id }) => ({ ref_node_id, type }))).toEqual([
      { ref_node_id: null, type: 'ancestor-summary' }, // root：距父 4 层，超出全文创
      { ref_node_id: null, type: 'ancestor-summary' }, // a：距父 3 层
      { ref_node_id: null, type: 'ancestor-summary' }, // b：距父 2 层
      { ref_node_id: 'c', type: 'ancestor-full' },     // 祖父：距父 1 层
      { ref_node_id: 'parent', type: 'ancestor-full' },// 父：距父 0 层
      { ref_node_id: null, type: 'annotation-seed' },
    ])
    const summary = written[0]
    expect(summary?.type).toBe('ancestor-summary')
    expect(summary?.content).toContain('root 的提问')
  })

  it('honors context.ancestorFullDepth = 10 to keep every ancestor full', () => {
    const path = [node('root', null), node('a', 'root'), node('b', 'a'), node('parent', 'b')]
    const { deps, written } = recorder()
    deps.nodes.getPathToRoot = () => path
    const settings = { get: (key: string) => (key === 'context.ancestorFullDepth' ? '10' : undefined) }

    buildBranchSegments({ ...deps, settings }, { childNodeId: 'child', parentNodeId: 'parent', seedText: '聚焦' })

    expect(written.filter((row) => row.type === 'ancestor-full')).toHaveLength(4)
    expect(written.some((row) => row.type === 'ancestor-summary')).toBe(false)
  })
})
