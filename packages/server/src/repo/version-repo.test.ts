import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb, type Db } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createMergeRepo } from './merge-repo'
import { createNodeRepo } from './node-repo'
import { createSegmentRepo } from './segment-repo'
import { createTreeRepo } from './tree-repo'
import { createVersionRepo } from './version-repo'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

describe('VersionRepo & MergeRepo', () => {
  it('snapshots with version_no incrementing from one', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { rootNode } = createTreeRepo(db, clock).create('t')
    const versions = createVersionRepo(db, clock)

    const first = versions.snapshot({
      nodeId: rootNode.id,
      userInput: 'q',
      aiResponse: 'a',
      changeKind: 'edit',
    })
    const second = versions.snapshot({
      nodeId: rootNode.id,
      userInput: 'q',
      aiResponse: 'b',
      changeKind: 'regenerate',
    })

    expect(first.version_no).toBe(1)
    expect(second.version_no).toBe(2)
    expect(versions.get(rootNode.id, 1)?.ai_response).toBe('a')
    expect(versions.get(rootNode.id, 2)?.change_kind).toBe('regenerate')
    expect(versions.listByNode(rootNode.id).map((version) => version.version_no)).toEqual([
      1, 2,
    ])
  })

  it('keeps version sequences independent per node', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const child = createNodeRepo(db, clock).create({
      treeId: tree.id,
      parentId: rootNode.id,
    })
    const versions = createVersionRepo(db, clock)

    versions.snapshot({
      nodeId: rootNode.id,
      userInput: null,
      aiResponse: 'root',
      changeKind: 'edit',
    })
    const childVersion = versions.snapshot({
      nodeId: child.id,
      userInput: 'child',
      aiResponse: null,
      changeKind: 'edit',
    })

    expect(childVersion.version_no).toBe(1)
  })

  it('records a merge without changing either subtree', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const landingSegment = createSegmentRepo(db).add({
      nodeId: rootNode.id,
      seq: 0,
      type: 'merged-conclusion',
      content: 'X',
    })
    const merges = createMergeRepo(db, clock)

    const merge = merges.record({
      sourceNodeId: child.id,
      targetNodeId: rootNode.id,
      conclusion: 'X',
      landingSegmentId: landingSegment.id,
    })

    expect(merge).toMatchObject({
      source_node_id: child.id,
      target_node_id: rootNode.id,
      conclusion: 'X',
      landing_segment_id: landingSegment.id,
    })
    expect(merges.listByTarget(rootNode.id)).toEqual([merge])
    expect(nodes.get(child.id)?.is_deleted).toBe(0)
  })
})
