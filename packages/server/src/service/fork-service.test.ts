import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'
import { createForkService } from './fork-service'

describe('ForkService', () => {
  it('atomically creates annotation, child node, and ordered branch segments', () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
    })
    const { tree, rootNode } = deps.trees.create('tree')
    const result = createForkService(deps).fork({
      anchorFrom: 2,
      anchorTo: 7,
      kind: 'selection',
      parentNodeId: rootNode.id,
      quotedText: 'Redis',
      seedText: 'Redis\n如何持久化？',
      treeId: tree.id,
    })

    expect(result.annotation.child_node_id).toBe(result.childNode.id)
    expect(result.childNode.parent_id).toBe(rootNode.id)
    expect(deps.segments.listByNode(result.childNode.id).map((segment) => segment.type))
      .toEqual(['ancestor-full', 'annotation-seed'])
  })
})
