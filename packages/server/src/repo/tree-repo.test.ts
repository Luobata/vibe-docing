import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb, type Db } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

describe('TreeRepo', () => {
  it('creates a tree with an empty root node', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))

    const { tree, rootNode } = repo.create('缓存设计')

    expect(tree.title).toBe('缓存设计')
    expect(tree.root_node_id).toBe(rootNode.id)
    expect(rootNode).toMatchObject({
      tree_id: tree.id,
      parent_id: null,
      user_input: null,
      ai_response: null,
      status: 'complete',
      is_deleted: 0,
    })
    expect(repo.get(tree.id)?.root_node_id).toBe(rootNode.id)
  })

  it('lists trees by most recently updated first', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const earlier = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))
    const later = createTreeRepo(db, fixedClock('2026-08-06T00:00:00.000Z'))

    const first = earlier.create('a')
    const second = later.create('b')

    expect(later.list().map((tree) => tree.id)).toEqual([
      second.tree.id,
      first.tree.id,
    ])
  })

  it('returns undefined for an unknown tree', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))

    expect(repo.get('missing')).toBeUndefined()
  })
})
