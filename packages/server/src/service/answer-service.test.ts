import { describe, expect, it } from 'vitest'
import { prosemirrorToPlainText } from '../context/prosemirror'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import { createNodeRepo } from '../repo/node-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { createTreeRepo } from '../repo/tree-repo'
import { createVersionRepo } from '../repo/version-repo'
import { fixedClock } from '../util/clock'
import { createAnswerService } from './answer-service'

function setup() {
  const db = openMemoryDb()
  const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const { rootNode } = createTreeRepo(db, clock).create('tree')
  const nodes = createNodeRepo(db, clock)
  const segments = createSegmentRepo(db)
  const versions = createVersionRepo(db, clock)
  return {
    nodes,
    rootNode,
    service: createAnswerService({ nodes, segments, versions }),
    versions,
  }
}

describe('AnswerService', () => {
  it('persists every stream increment, completes, and increments version_no', async () => {
    const context = setup()
    const observed: Array<{ status: string; text: string }> = []

    const first = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['缓存', '有多种'] }),
        userInput: '讲缓存',
      },
      () => {
        const current = context.nodes.get(context.rootNode.id)!
        observed.push({
          status: current.status,
          text: prosemirrorToPlainText(current.ai_response),
        })
      },
    )

    expect(observed).toEqual([
      { status: 'streaming', text: '缓存' },
      { status: 'streaming', text: '缓存有多种' },
    ])
    expect(first.status).toBe('complete')
    expect(prosemirrorToPlainText(first.ai_response)).toBe('缓存有多种')

    await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['第二版'] }),
        userInput: '重新生成',
      },
      () => {},
    )
    const versions = context.versions.listByNode(context.rootNode.id)
    expect(versions.map((version) => version.version_no)).toEqual([1, 2])
    expect(versions.map((version) => version.change_kind)).toEqual([
      'regenerate',
      'regenerate',
    ])
  })

  it('preserves partial content, marks error, snapshots, and rethrows', async () => {
    const context = setup()
    await expect(
      context.service.generate(
        {
          nodeId: context.rootNode.id,
          provider: createMockProvider({ chunks: ['部分', '丢失'], failAfter: 1 }),
          userInput: '问题',
        },
        () => {},
      ),
    ).rejects.toThrow('mock stream failure')

    const node = context.nodes.get(context.rootNode.id)!
    expect(node.status).toBe('error')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('部分')
    expect(context.versions.listByNode(node.id)).toHaveLength(1)
  })
})
