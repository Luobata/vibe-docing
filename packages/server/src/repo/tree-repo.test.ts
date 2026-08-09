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

  it('soft-deletes a tree so it no longer appears in the list', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))

    const { tree } = repo.create('待删除')
    repo.create('保留')
    repo.softDelete(tree.id)

    expect(repo.list().map((t) => t.title)).toEqual(['保留'])
    expect(repo.get(tree.id)).toBeUndefined()
  })

  it('round-trips a soft-deleted tree through the deleted list and restore', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const initial = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))
    const { tree } = initial.create('可恢复')
    createTreeRepo(db, fixedClock('2026-08-06T00:00:00.000Z')).create('保留')

    initial.softDelete(tree.id)
    expect(initial.listDeleted()).toEqual([
      expect.objectContaining({ id: tree.id, is_deleted: 1 }),
    ])
    expect(initial.list().some((item) => item.id === tree.id)).toBe(false)

    const restored = createTreeRepo(
      db,
      fixedClock('2026-08-07T00:00:00.000Z'),
    ).restore(tree.id)

    expect(restored).toMatchObject({
      id: tree.id,
      is_deleted: 0,
      updated_at: '2026-08-07T00:00:00.000Z',
    })
    expect(initial.listDeleted()).toHaveLength(0)
    expect(initial.list().map((item) => item.id)).toEqual([
      tree.id,
      expect.any(String),
    ])
  })

  it('renames a tree title', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))

    const { tree } = repo.create('旧标题')
    const renamed = repo.rename(tree.id, '新标题')

    expect(renamed?.title).toBe('新标题')
    expect(repo.get(tree.id)?.title).toBe('新标题')
  })
})
