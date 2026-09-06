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
        getChildren: () => [],
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

  it('assembles direction-first correction context with recursive evidence', () => {
    const nodes = new Map<string, NodeRow>([
      ['parent', {
        ai_response: null, content_schema_version: 2, document_content: '父文档原文', created_at: '', id: 'parent',
        is_deleted: 0, model_override: null, parent_id: null, sort_order: 0, status: 'complete',
        tree_id: 'tree', updated_at: '', user_input: '父问题',
      }],
      ['source', {
        ai_response: null, content_schema_version: 2, document_content: '分支证据一', created_at: '', id: 'source',
        is_deleted: 0, model_override: null, parent_id: 'parent', sort_order: 0, status: 'complete',
        tree_id: 'tree', updated_at: '', user_input: '分支问题',
      }],
      ['child', {
        ai_response: null, content_schema_version: 2, document_content: '递归证据二', created_at: '', id: 'child',
        is_deleted: 0, model_override: null, parent_id: 'source', sort_order: 0, status: 'complete',
        tree_id: 'tree', updated_at: '', user_input: '继续验证',
      }],
    ])
    const engine = createContextEngine({
      nodes: {
        get: (id) => nodes.get(id),
        getChildren: (id) => [...nodes.values()].filter((node) => node.parent_id === id),
        getPathToRoot: () => [],
      },
      segments: { add: () => { throw new Error('unused') }, listByNode: () => [] },
      versions: { get: () => undefined },
    })

    const messages = engine.assembleForCorrection({
      direction: '把结论改成 A', includeSubtree: true, mode: 'patch', sourceNodeId: 'source', targetNodeId: 'parent',
    })

    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0].content).toContain('这是用户对本次合并的引导说明')
    expect(messages[0].content).toContain('把结论改成 A')
    expect(messages[1].content).toContain('待修订靶子')
    expect(messages[1].content).toContain('勿照抄、勿复述说明未涉及的内容')
    expect(messages[1].content).toContain('父文档原文')
    expect(messages[2].content).toContain('分支证据一')
    expect(messages[2].content).toContain('递归证据二')
  })

  it('uses an append-specific output contract and reference guidance', () => {
    const nodes = new Map<string, NodeRow>([
      ['parent', {
        ai_response: null, content_schema_version: 2, document_content: '父文档原文', created_at: '', id: 'parent',
        is_deleted: 0, model_override: null, parent_id: null, sort_order: 0, status: 'complete',
        tree_id: 'tree', updated_at: '', user_input: '父问题',
      }],
      ['source', {
        ai_response: null, content_schema_version: 2, document_content: '分支证据', created_at: '', id: 'source',
        is_deleted: 0, model_override: null, parent_id: 'parent', sort_order: 0, status: 'complete',
        tree_id: 'tree', updated_at: '', user_input: '分支问题',
      }],
    ])
    const engine = createContextEngine({
      nodes: {
        get: (id) => nodes.get(id),
        getChildren: () => [],
        getPathToRoot: () => [],
      },
      segments: { add: () => { throw new Error('unused') }, listByNode: () => [] },
      versions: { get: () => undefined },
    })

    const messages = engine.assembleForCorrection({
      direction: '提炼分支要点补充', includeSubtree: true, mode: 'append', sourceNodeId: 'source', targetNodeId: 'parent',
    })

    expect(messages[0].content).toContain('这是用户对本次合并的引导说明')
    expect(messages[0].content).toContain('{"section":{"title"')
    expect(messages[1].content).toContain('可参考父文档与分支证据，但不得整段复制原文')
    expect(messages[1].content).not.toContain('勿照抄、勿复述说明未涉及的内容')
    expect(messages[2].content).toContain('分支证据')
  })

  it('caps oversized branch evidence and marks the truncation', () => {
    const parent = {
      ai_response: null, content_schema_version: 2, document_content: '父文档', created_at: '', id: 'parent',
      is_deleted: 0 as const, model_override: null, parent_id: null, sort_order: 0, status: 'complete' as const,
      tree_id: 'tree', updated_at: '', user_input: null,
    }
    const source = { ...parent, document_content: 'x'.repeat(20_000), id: 'source', parent_id: 'parent' }
    const engine = createContextEngine({
      nodes: {
        get: (id) => id === 'parent' ? parent : id === 'source' ? source : undefined,
        getChildren: () => [],
        getPathToRoot: () => [],
      },
      segments: { add: () => { throw new Error('unused') }, listByNode: () => [] },
      versions: { get: () => undefined },
    })

    const evidence = engine.assembleForCorrection({
      direction: '纠正', includeSubtree: true, mode: 'rewrite', sourceNodeId: 'source', targetNodeId: 'parent',
    })[2].content

    expect(evidence).toContain('[分支证据因达到体量上限已截断]')
    expect(evidence.length).toBeLessThan(12_200)
  })
})
