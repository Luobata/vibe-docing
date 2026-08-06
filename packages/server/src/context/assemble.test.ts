import type {
  ContextSegmentRow,
  NodeRow,
  NodeVersionRow,
  SegmentType,
} from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { assembleContext } from './assemble'
import { plainTextToProseMirror, prosemirrorToPlainText } from './prosemirror'

function node(id: string, question: string, answer: string): NodeRow {
  return {
    ai_response: plainTextToProseMirror(answer),
    created_at: '2026-08-05T00:00:00.000Z',
    id,
    is_deleted: 0,
    model_override: null,
    parent_id: null,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '2026-08-05T00:00:00.000Z',
    user_input: question,
  }
}

function segment(
  seq: number,
  type: SegmentType,
  overrides: Partial<ContextSegmentRow> = {},
): ContextSegmentRow {
  return {
    content: null,
    id: `segment-${seq}`,
    node_id: 'current',
    ref_node_id: null,
    ref_version_no: null,
    seq,
    type,
    ...overrides,
  }
}

describe('ProseMirror text conversion', () => {
  it('round-trips multi-line plain text', () => {
    const value = '第一行\n第二行'
    expect(prosemirrorToPlainText(plainTextToProseMirror(value))).toBe(value)
  })
})

describe('assembleContext', () => {
  it('orders segments by seq and emits ancestors, seed, summary, merge, current input', () => {
    const nodes = new Map([
      ['root', node('root', '根问题', '根回答')],
      ['parent', node('parent', '父问题', '父回答')],
    ])
    const lockedVersion: NodeVersionRow = {
      ai_response: plainTextToProseMirror('父回答 v1'),
      change_kind: 'edit',
      created_at: '2026-08-05T00:00:00.000Z',
      id: 'version-1',
      node_id: 'parent',
      user_input: '父问题 v1',
      version_no: 1,
    }
    const unordered = [
      segment(4, 'merged-conclusion', { content: '合并结论' }),
      segment(1, 'ancestor-full', { ref_node_id: 'parent', ref_version_no: 1 }),
      segment(3, 'ancestor-summary', { content: '更早摘要' }),
      segment(0, 'ancestor-full', { ref_node_id: 'root' }),
      segment(2, 'annotation-seed', { content: '聚焦点' }),
    ]

    const messages = assembleContext(
      {
        nodes: { get: (id) => nodes.get(id) },
        segments: { listByNode: () => unordered },
        versions: {
          get: (nodeId, versionNo) =>
            nodeId === 'parent' && versionNo === 1 ? lockedVersion : undefined,
        },
      },
      'current',
      '当前问题',
    )

    expect(messages).toEqual([
      { content: '根问题', role: 'user' },
      { content: '根回答', role: 'assistant' },
      { content: '父问题 v1', role: 'user' },
      { content: '父回答 v1', role: 'assistant' },
      { content: '[聚焦] 聚焦点', role: 'user' },
      { content: '[祖先摘要] 更早摘要', role: 'user' },
      { content: '[已并入结论] 合并结论', role: 'user' },
      { content: '当前问题', role: 'user' },
    ])
  })
})
