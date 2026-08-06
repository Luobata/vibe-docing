import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb, type Db } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createNodeRepo } from './node-repo'
import { createSegmentRepo } from './segment-repo'
import { createTreeRepo } from './tree-repo'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

describe('SegmentRepo', () => {
  it('adds segments and lists them ordered by seq', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const child = createNodeRepo(db, clock).create({
      treeId: tree.id,
      parentId: rootNode.id,
    })
    const segments = createSegmentRepo(db)

    segments.add({
      nodeId: child.id,
      seq: 1,
      type: 'annotation-seed',
      content: 'seed text',
    })
    segments.add({
      nodeId: child.id,
      seq: 0,
      type: 'ancestor-full',
      refNodeId: rootNode.id,
    })

    const list = segments.listByNode(child.id)
    expect(list.map((segment) => segment.type)).toEqual([
      'ancestor-full',
      'annotation-seed',
    ])
    expect(list[0]).toMatchObject({
      ref_node_id: rootNode.id,
      ref_version_no: null,
      content: null,
    })
    expect(segments.nextSeq(child.id)).toBe(2)
  })

  it('starts sequence numbers at zero for a node without segments', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { rootNode } = createTreeRepo(db, clock).create('t')

    expect(createSegmentRepo(db).nextSeq(rootNode.id)).toBe(0)
  })
})
