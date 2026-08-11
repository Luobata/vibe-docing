import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(join(currentDirectory, 'schema.sql'), 'utf8')

export type Db = Database.Database

export function openDb(path: string): Db {
  const db = new Database(path)

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(schema)
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

// Idempotent migrations for databases created before a column existed.
// `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so new columns
// must be added explicitly.
function migrate(db: Db): void {
  const treeColumns = db.prepare('PRAGMA table_info(trees)').all() as Array<{ name: string }>
  if (!treeColumns.some((column) => column.name === 'is_deleted')) {
    db.exec('ALTER TABLE trees ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0')
  }
  const annotationColumns = db.prepare('PRAGMA table_info(annotations)').all() as Array<{ name: string }>
  if (!annotationColumns.some((column) => column.name === 'visual_target_json')) {
    db.exec('ALTER TABLE annotations ADD COLUMN visual_target_json TEXT')
  }

  // Kept here as well as schema.sql so an older database upgrades safely.
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_shares (
      id TEXT PRIMARY KEY,
      tree_id TEXT NOT NULL REFERENCES trees(id),
      token_hash TEXT NOT NULL,
      token_hint TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_document_shares_tree ON document_shares(tree_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_shares_active_tree
      ON document_shares(tree_id) WHERE is_enabled = 1;
  `)
}

export function openMemoryDb(): Db {
  return openDb(':memory:')
}
