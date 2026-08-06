import { afterEach, describe, expect, it } from 'vitest'
import type { Db } from './connection'
import { openMemoryDb } from './connection'

const openDatabases: Db[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
})

describe('db schema', () => {
  it('creates all tables idempotently', () => {
    const db = openMemoryDb()
    openDatabases.push(db)

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = rows.map((row) => row.name)

    for (const table of [
      'trees',
      'nodes',
      'annotations',
      'context_segments',
      'node_versions',
      'merges',
      'settings',
    ]) {
      expect(names).toContain(table)
    }

    expect(() => openMemoryDb().close()).not.toThrow()
  })

  it('enforces foreign keys', () => {
    const db = openMemoryDb()
    openDatabases.push(db)

    expect(
      db.pragma('foreign_keys', { simple: true }),
    ).toBe(1)
    expect(() =>
      db
        .prepare(
          "INSERT INTO nodes (id, tree_id, sort_order, status, is_deleted, created_at, updated_at) VALUES ('n1','missing',0,'draft',0,'now','now')",
        )
        .run(),
    ).toThrow()
  })

  it('defines the node soft-delete flag', () => {
    const db = openMemoryDb()
    openDatabases.push(db)

    const columns = db.prepare('PRAGMA table_info(nodes)').all() as { name: string }[]

    expect(columns.map((column) => column.name)).toContain('is_deleted')
  })
})
