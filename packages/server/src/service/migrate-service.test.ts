import { describe, expect, it } from 'vitest'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createMigrateService } from './migrate-service'

describe('MigrateService', () => {
  it('rehooks without re-answering and rebuilds the active path while preserving merges', () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
    })
    const { rootNode, tree } = deps.trees.create('t')
    const oldParent = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const newParent = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: '新的父节点',
    })
    deps.nodes.create({ parentId: newParent.id, treeId: tree.id })
    const answered = deps.nodes.create({
      parentId: oldParent.id,
      treeId: tree.id,
      userInput: '乐观问题',
    })
    deps.nodes.updateContent(answered.id, {
      aiResponse: '{"type":"doc","content":[]}',
      status: 'complete',
    })
    deps.context.buildBranch({
      childNodeId: answered.id,
      parentNodeId: oldParent.id,
      seedText: '旧 seed',
    })
    const preservedMerge = deps.segments.add({
      content: '已合并的结论',
      nodeId: answered.id,
      seq: deps.segments.nextSeq(answered.id),
      type: 'merged-conclusion',
    })

    const moved = createMigrateService(deps).migrate({
      newParentId: newParent.id,
      nodeId: answered.id,
      seedText: 'Redis 深入',
      target: 'new-branch',
    })

    expect(moved.parent_id).toBe(newParent.id)
    expect(moved.sort_order).toBe(1)
    expect(moved.ai_response).toBe('{"type":"doc","content":[]}')
    expect(deps.nodes.getPathToRoot(answered.id).map((node) => node.id)).toEqual([
      rootNode.id,
      newParent.id,
      answered.id,
    ])
    const segments = deps.segments.listByNode(answered.id)
    expect(segments.map((segment) => segment.type)).toEqual([
      'ancestor-full',
      'ancestor-full',
      'annotation-seed',
      'merged-conclusion',
    ])
    expect(segments.slice(0, 2).map((segment) => segment.ref_node_id)).toEqual([
      rootNode.id,
      newParent.id,
    ])
    expect(segments[2].content).toBe('Redis 深入')
    expect(segments[3].id).toBe(preservedMerge.id)
  })

  it('rejects migrations that would create a cycle', () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })

    expect(() =>
      createMigrateService(deps).migrate({
        newParentId: child.id,
        nodeId: rootNode.id,
        target: 'bound-subdoc',
      }),
    ).toThrow('cycle')
  })
})

