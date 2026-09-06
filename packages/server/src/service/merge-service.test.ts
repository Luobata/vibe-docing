import { describe, expect, it, vi } from 'vitest'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import { fixedClock } from '../util/clock'
import { createMergeService, MergeAlreadyExistsError } from './merge-service'

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

  it('rejects a repeated merge before calling the provider or adding audit rows', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const service = createMergeService(deps)
    await service.merge({
      provider: createMockProvider({ chunks: ['first conclusion'] }),
      sourceNodeId: child.id,
      targetNodeId: rootNode.id,
    })
    const provider = createMockProvider({ chunks: ['must not run'] })
    const complete = vi.spyOn(provider, 'complete')
    const segmentCount = deps.segments.listByNode(rootNode.id).length
    const versionCount = deps.versions.listByNode(rootNode.id).length

    await expect(service.merge({
      provider,
      sourceNodeId: child.id,
      targetNodeId: rootNode.id,
    })).rejects.toBeInstanceOf(MergeAlreadyExistsError)

    expect(complete).not.toHaveBeenCalled()
    expect(deps.merges.listByTarget(rootNode.id)).toHaveLength(1)
    expect(deps.segments.listByNode(rootNode.id)).toHaveLength(segmentCount)
    expect(deps.versions.listByNode(rootNode.id)).toHaveLength(versionCount)
  })

  it('allows only one concurrent merge to commit on a single database connection', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const resolvers: Array<(value: string) => void> = []
    const provider = {
      ...createMockProvider(),
      complete: vi.fn(() => new Promise<string>((resolve) => { resolvers.push(resolve) })),
    }
    const service = createMergeService(deps)

    const first = service.merge({ provider, sourceNodeId: child.id, targetNodeId: rootNode.id })
    const second = service.merge({ provider, sourceNodeId: child.id, targetNodeId: rootNode.id })
    expect(provider.complete).toHaveBeenCalledTimes(2)
    resolvers.forEach((resolve, index) => resolve(`conclusion ${index + 1}`))

    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: expect.any(MergeAlreadyExistsError) })
    expect(deps.merges.listByTarget(rootNode.id)).toHaveLength(1)
    expect(deps.segments.listByNode(rootNode.id).filter((segment) => segment.type === 'merged-conclusion')).toHaveLength(1)
  })
})
