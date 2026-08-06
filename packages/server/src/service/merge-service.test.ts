import { describe, expect, it } from 'vitest'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import { fixedClock } from '../util/clock'
import { createMergeService } from './merge-service'

describe('MergeService', () => {
  it('appends a conclusion and audit records without destroying the source subtree', async () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
    })
    const { rootNode, tree } = deps.trees.create('t')
    deps.versions.snapshot({
      aiResponse: rootNode.ai_response,
      changeKind: 'edit',
      nodeId: rootNode.id,
      userInput: rootNode.user_input,
    })
    const child = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: '探索 Redis',
    })
    const grandchild = deps.nodes.create({
      parentId: child.id,
      treeId: tree.id,
      userInput: '持久化',
    })
    let sawDistillPrompt = false
    const provider = createMockProvider({
      chunks: ['  结论：使用 AOF  '],
      onMessages: (messages) => {
        sawDistillPrompt = messages.some((message) =>
          message.content.includes('提炼'),
        )
      },
    })

    const result = await createMergeService(deps).merge({
      provider,
      sourceNodeId: child.id,
      targetNodeId: rootNode.id,
    })

    expect(sawDistillPrompt).toBe(true)
    expect(result.segment.type).toBe('merged-conclusion')
    expect(result.segment.content).toBe('结论：使用 AOF')
    expect(result.merge.landing_segment_id).toBe(result.segment.id)
    expect(deps.merges.listByTarget(rootNode.id)).toHaveLength(1)
    expect(deps.versions.listByNode(rootNode.id).map((item) => item.version_no)).toEqual([
      1, 2,
    ])
    expect(deps.versions.listByNode(rootNode.id)[1].change_kind).toBe('merge')
    expect(deps.nodes.get(child.id)?.is_deleted).toBe(0)
    expect(deps.nodes.get(grandchild.id)?.is_deleted).toBe(0)
  })

  it('only permits merging into the direct parent', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const grandchild = deps.nodes.create({ parentId: child.id, treeId: tree.id })

    await expect(
      createMergeService(deps).merge({
        provider: createMockProvider({ chunks: ['x'] }),
        sourceNodeId: grandchild.id,
        targetNodeId: rootNode.id,
      }),
    ).rejects.toThrow('direct parent')
  })
})

