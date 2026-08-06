import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb, type Db } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createAnnotationRepo } from './annotation-repo'
import { createNodeRepo } from './node-repo'
import { createTreeRepo } from './tree-repo'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

describe('AnnotationRepo', () => {
  it('creates a selection annotation and links a child', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const annotations = createAnnotationRepo(db, clock)

    const annotation = annotations.create({
      nodeId: rootNode.id,
      kind: 'selection',
      anchorFrom: 5,
      anchorTo: 12,
      quotedText: 'Redis',
      note: '深入这个',
    })
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    annotations.linkChild(annotation.id, child.id)

    expect(annotation).toMatchObject({
      kind: 'selection',
      anchor_from: 5,
      anchor_to: 12,
      quoted_text: 'Redis',
      note: '深入这个',
      child_node_id: null,
    })
    expect(annotations.get(annotation.id)?.child_node_id).toBe(child.id)
    expect(annotations.listByNode(rootNode.id)).toHaveLength(1)
  })

  it('stores omitted whole-annotation anchors as null', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { rootNode } = createTreeRepo(db, clock).create('t')
    const annotations = createAnnotationRepo(db, clock)

    const annotation = annotations.create({ nodeId: rootNode.id, kind: 'whole' })

    expect(annotation.anchor_from).toBeNull()
    expect(annotation.anchor_to).toBeNull()
    expect(annotation.quoted_text).toBeNull()
    expect(annotation.note).toBeNull()
  })
})
