import type { ContextSegmentRow, NodeRow, NodeVersionRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { resolveSegmentContent } from './resolve-segment'

function node(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    ai_response: 'latest answer',
    created_at: '2026-08-05T00:00:00.000Z',
    id: 'ancestor',
    is_deleted: 0,
    model_override: null,
    parent_id: null,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '2026-08-05T00:00:00.000Z',
    user_input: 'latest question',
    ...overrides,
  }
}

function segment(overrides: Partial<ContextSegmentRow> = {}): ContextSegmentRow {
  return {
    content: null,
    id: 'segment-1',
    node_id: 'current',
    ref_node_id: 'ancestor',
    ref_version_no: null,
    seq: 0,
    type: 'ancestor-full',
    ...overrides,
  }
}

const locked: NodeVersionRow = {
  ai_response: 'locked answer',
  change_kind: 'edit',
  created_at: '2026-08-05T00:00:00.000Z',
  id: 'version-1',
  node_id: 'ancestor',
  user_input: 'locked question',
  version_no: 1,
}

describe('resolveSegmentContent', () => {
  it('follows current node content when ref_version_no is null', () => {
    const result = resolveSegmentContent(
      { nodes: { get: () => node() }, versions: { get: () => undefined } },
      segment(),
    )
    expect(result).toEqual({
      aiResponse: 'latest answer',
      kind: 'ancestor',
      userInput: 'latest question',
    })
  })

  it('uses the locked version snapshot when ref_version_no is set', () => {
    const calls: Array<[string, number]> = []
    const result = resolveSegmentContent(
      {
        nodes: { get: () => node() },
        versions: {
          get(nodeId, versionNo) {
            calls.push([nodeId, versionNo])
            return locked
          },
        },
      },
      segment({ ref_version_no: 1 }),
    )
    expect(calls).toEqual([['ancestor', 1]])
    expect(result).toEqual({
      aiResponse: 'locked answer',
      kind: 'ancestor',
      userInput: 'locked question',
    })
  })

  it('skips a soft-deleted referenced node, including locked versions', () => {
    let versionRead = false
    const result = resolveSegmentContent(
      {
        nodes: { get: () => node({ is_deleted: 1 }) },
        versions: {
          get() {
            versionRead = true
            return locked
          },
        },
      },
      segment({ ref_version_no: 1 }),
    )
    expect(result).toEqual({ kind: 'skip' })
    expect(versionRead).toBe(false)
  })

  it.each([
    ['annotation-seed', 'seed'],
    ['merged-conclusion', 'merged'],
    ['ancestor-summary', 'summary'],
  ] as const)('resolves %s as snapshot text', (type, content) => {
    const result = resolveSegmentContent(
      { nodes: { get: () => undefined }, versions: { get: () => undefined } },
      segment({ content, ref_node_id: null, type }),
    )
    expect(result).toEqual({ kind: 'text', text: content })
  })
})
