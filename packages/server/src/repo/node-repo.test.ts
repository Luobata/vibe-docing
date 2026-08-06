import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb, type Db } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createNodeRepo } from './node-repo'
import { createTreeRepo } from './tree-repo'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

function setup() {
  const db = openMemoryDb()
  openDatabases.push(db)
  const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const trees = createTreeRepo(db, clock)
  const nodes = createNodeRepo(db, clock)
  const { tree, rootNode } = trees.create('t')

  return { db, nodes, tree, rootNode }
}

describe('NodeRepo', () => {
  it('creates children with incrementing sort_order', () => {
    const { nodes, tree, rootNode } = setup()

    const first = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const second = nodes.create({ treeId: tree.id, parentId: rootNode.id })

    expect(first.sort_order).toBe(0)
    expect(second.sort_order).toBe(1)
    expect(nodes.getChildren(rootNode.id).map((node) => node.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  it('calculates sort_order independently for each parent', () => {
    const { nodes, tree, rootNode } = setup()
    const firstParent = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const secondParent = nodes.create({ treeId: tree.id, parentId: rootNode.id })

    expect(
      nodes.create({ treeId: tree.id, parentId: firstParent.id }).sort_order,
    ).toBe(0)
    expect(
      nodes.create({ treeId: tree.id, parentId: secondParent.id }).sort_order,
    ).toBe(0)
  })

  it('returns the path from root to node', () => {
    const { nodes, tree, rootNode } = setup()
    const parent = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const child = nodes.create({ treeId: tree.id, parentId: parent.id })

    expect(nodes.getPathToRoot(child.id).map((node) => node.id)).toEqual([
      rootNode.id,
      parent.id,
      child.id,
    ])
  })

  it('soft deletes a node and its entire subtree', () => {
    const { nodes, tree, rootNode } = setup()
    const parent = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const child = nodes.create({ treeId: tree.id, parentId: parent.id })

    nodes.softDelete(parent.id)

    expect(nodes.get(parent.id)?.is_deleted).toBe(1)
    expect(nodes.get(child.id)?.is_deleted).toBe(1)
    expect(nodes.getChildren(rootNode.id)).toHaveLength(0)
    expect(nodes.listDeleted(tree.id).map((node) => node.id).sort()).toEqual(
      [parent.id, child.id].sort(),
    )
  })

  it('restores a node and its entire subtree', () => {
    const { nodes, tree, rootNode } = setup()
    const parent = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const child = nodes.create({ treeId: tree.id, parentId: parent.id })
    nodes.softDelete(parent.id)

    nodes.restore(parent.id)

    expect(nodes.get(parent.id)?.is_deleted).toBe(0)
    expect(nodes.get(child.id)?.is_deleted).toBe(0)
  })

  it('updates only the requested content fields', () => {
    const { nodes, tree, rootNode } = setup()
    const node = nodes.create({
      treeId: tree.id,
      parentId: rootNode.id,
      userInput: 'q',
    })

    const updated = nodes.updateContent(node.id, {
      aiResponse: '{"type":"doc"}',
      status: 'complete',
    })

    expect(updated.user_input).toBe('q')
    expect(updated.ai_response).toBe('{"type":"doc"}')
    expect(updated.status).toBe('complete')
  })

  it('throws when updating an unknown node', () => {
    const { nodes } = setup()

    expect(() => nodes.updateContent('missing', { status: 'error' })).toThrow(
      'Node not found: missing',
    )
  })
})
