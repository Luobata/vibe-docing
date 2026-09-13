import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from './connection'
import { openDb, openMemoryDb } from './connection'

const openDatabases: Db[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close()
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('db schema', () => {
  it('adds persistent tree folders to an existing database and reopens idempotently', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vibe-tree-folders-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'legacy.db')
    const legacy = openDb(databasePath)
    legacy.exec(`
      DROP TABLE tree_folders;
      INSERT INTO trees (id, title, folder, created_at, updated_at)
        VALUES ('t1', '保留', '工作', 'then', 'then');
    `)
    const before = legacy.prepare('SELECT * FROM trees').all()
    legacy.close()

    const upgraded = openDb(databasePath)
    expect(upgraded.prepare('SELECT * FROM trees').all()).toEqual(before)
    upgraded.prepare('INSERT INTO tree_folders (path, created_at) VALUES (?, ?)').run('空目录/子目录', 'now')
    upgraded.close()

    const reopened = openDb(databasePath)
    openDatabases.push(reopened)
    expect(reopened.prepare('SELECT * FROM trees').all()).toEqual(before)
    expect(reopened.prepare('SELECT * FROM tree_folders').all()).toEqual([{ path: '空目录/子目录', created_at: 'now' }])
    expect(reopened.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
  })

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
      'document_shares',
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
    expect(columns.map((column) => column.name)).toContain('content_revision')
    expect(columns.map((column) => column.name)).toContain('content_schema_version')
    expect(columns.map((column) => column.name)).toContain('content_updated_at')
    expect(columns.map((column) => column.name)).toContain('vault_root')
    expect(columns.map((column) => column.name)).toContain('file_path')
    expect(columns.map((column) => column.name)).toContain('file_kind')
    expect(columns.map((column) => column.name)).toContain('content_hash')
    expect(columns.map((column) => column.name)).toContain('document_content')
  })

  it('defines editable document version and anchor metadata', () => {
    const db = openMemoryDb()
    openDatabases.push(db)
    const annotationColumns = db.prepare('PRAGMA table_info(annotations)').all() as { name: string }[]
    const versionColumns = db.prepare('PRAGMA table_info(node_versions)').all() as { name: string }[]
    expect(annotationColumns.map((column) => column.name)).toContain('anchor_status')
    expect(versionColumns.map((column) => column.name)).toContain('edit_session_id')
    expect(versionColumns.map((column) => column.name)).toContain('content_revision')
    expect(versionColumns.map((column) => column.name)).toContain('document_content')
  })

  it('adds edit-session metadata before creating its index on a legacy database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vibe-legacy-db-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'legacy.db')
    const legacy = new Database(databasePath)
    legacy.exec(`
      CREATE TABLE trees (id TEXT PRIMARY KEY, title TEXT NOT NULL, root_node_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE nodes (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, parent_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, user_input TEXT, ai_response TEXT, status TEXT NOT NULL DEFAULT 'draft', is_deleted INTEGER NOT NULL DEFAULT 0, model_override TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE annotations (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, kind TEXT NOT NULL, anchor_from INTEGER, anchor_to INTEGER, quoted_text TEXT, note TEXT, child_node_id TEXT, visual_target_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE node_versions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, version_no INTEGER NOT NULL, user_input TEXT, ai_response TEXT, change_kind TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO trees (id, title, root_node_id, created_at, updated_at) VALUES ('t1', 'Legacy', 'n1', 'now', 'now');
      INSERT INTO nodes (id, tree_id, parent_id, sort_order, user_input, ai_response, status, is_deleted, model_override, created_at, updated_at)
        VALUES ('n1', 't1', NULL, 0, 'q', 'legacy body', 'complete', 0, NULL, 'now', 'now');
      INSERT INTO node_versions (id, node_id, version_no, user_input, ai_response, change_kind, created_at)
        VALUES ('v1', 'n1', 1, 'q', 'legacy version body', 'edit', 'now');
    `)
    legacy.close()

    const upgraded = openDb(databasePath)
    openDatabases.push(upgraded)
    const columns = upgraded.prepare('PRAGMA table_info(node_versions)').all() as { name: string }[]
    const indexes = upgraded.prepare('PRAGMA index_list(node_versions)').all() as { name: string }[]
    expect(columns.map((column) => column.name)).toContain('edit_session_id')
    expect(columns.map((column) => column.name)).toContain('document_content')
    expect(indexes.map((index) => index.name)).toContain('idx_versions_edit_session')
    expect(upgraded.prepare('SELECT ai_response, document_content FROM nodes WHERE id = ?').get('n1'))
      .toEqual({ ai_response: 'legacy body', document_content: 'legacy body' })
    expect(upgraded.prepare('SELECT ai_response, document_content FROM node_versions WHERE id = ?').get('v1'))
      .toEqual({ ai_response: 'legacy version body', document_content: 'legacy version body' })
  })

  it('rebuilds legacy merges without losing rows and remains idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vibe-legacy-merges-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'legacy.db')
    const legacy = new Database(databasePath)
    legacy.exec(`
      CREATE TABLE trees (id TEXT PRIMARY KEY, title TEXT NOT NULL, root_node_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE nodes (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, parent_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, user_input TEXT, ai_response TEXT, status TEXT NOT NULL DEFAULT 'draft', is_deleted INTEGER NOT NULL DEFAULT 0, model_override TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE context_segments (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, ref_node_id TEXT, ref_version_no INTEGER, content TEXT);
      CREATE TABLE merges (id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL, conclusion TEXT NOT NULL, landing_segment_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO trees (id, title, root_node_id, created_at, updated_at) VALUES ('t1', 'Legacy', 'parent', 'now', 'now');
      INSERT INTO nodes (id, tree_id, parent_id, sort_order, user_input, ai_response, status, is_deleted, model_override, created_at, updated_at)
        VALUES ('parent', 't1', NULL, 0, 'parent', 'parent body', 'complete', 0, NULL, 'now', 'now'),
               ('source', 't1', 'parent', 0, 'source', 'source body', 'complete', 0, NULL, 'now', 'now');
      INSERT INTO context_segments (id, node_id, seq, type, ref_node_id, ref_version_no, content)
        VALUES ('segment', 'parent', 0, 'merged-conclusion', NULL, NULL, 'legacy conclusion');
      INSERT INTO merges (id, source_node_id, target_node_id, conclusion, landing_segment_id, created_at)
        VALUES ('merge', 'source', 'parent', 'legacy conclusion', 'segment', 'now');
    `)
    legacy.close()

    const upgraded = openDb(databasePath)
    const columns = upgraded.prepare('PRAGMA table_info(merges)').all() as Array<{ name: string; notnull: number }>
    expect(columns.find((column) => column.name === 'landing_segment_id')?.notnull).toBe(0)
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['kind', 'direction']))
    expect(upgraded.prepare('SELECT * FROM merges WHERE id = ?').get('merge')).toEqual({
      conclusion: 'legacy conclusion',
      created_at: 'now',
      direction: null,
      id: 'merge',
      kind: 'summary',
      landing_segment_id: 'segment',
      source_node_id: 'source',
      target_node_id: 'parent',
    })
    upgraded.close()

    const reopened = openDb(databasePath)
    openDatabases.push(reopened)
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM merges').get()).toEqual({ count: 1 })
    expect(reopened.pragma('foreign_key_check')).toEqual([])
  })

  it('scopes active document shares by node', () => {
    const db = openMemoryDb()
    openDatabases.push(db)

    const columns = db.prepare('PRAGMA table_info(document_shares)').all() as { name: string }[]
    const indexes = db.prepare('PRAGMA index_list(document_shares)').all() as { name: string }[]

    expect(columns.map((column) => column.name)).toContain('node_id')
    expect(indexes.map((index) => index.name)).toContain('idx_document_shares_active_node')
    expect(indexes.map((index) => index.name)).not.toContain('idx_document_shares_active_tree')
  })
})
