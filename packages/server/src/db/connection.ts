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
    // Legacy databases need new columns before schema-level indexes can refer
    // to them. Tables are created first, migrations run second, and indexes
    // from the canonical schema are applied last.
    db.exec(schema.replace(/CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_vault_file[\s\S]*?;\s*/m, ''))
    migrate(db)
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_vault_file
        ON nodes(vault_root, file_path)
        WHERE vault_root IS NOT NULL AND file_path IS NOT NULL;
    `)
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS tree_folders (
      path TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `)
  const treeColumns = db.prepare('PRAGMA table_info(trees)').all() as Array<{ name: string }>
  if (!treeColumns.some((column) => column.name === 'is_deleted')) {
    db.exec('ALTER TABLE trees ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0')
  }
  if (!treeColumns.some((column) => column.name === 'folder')) {
    db.exec('ALTER TABLE trees ADD COLUMN folder TEXT')
  }
  const annotationColumns = db.prepare('PRAGMA table_info(annotations)').all() as Array<{ name: string }>
  if (!annotationColumns.some((column) => column.name === 'visual_target_json')) {
    db.exec('ALTER TABLE annotations ADD COLUMN visual_target_json TEXT')
  }
  if (!annotationColumns.some((column) => column.name === 'anchor_status')) {
    db.exec("ALTER TABLE annotations ADD COLUMN anchor_status TEXT NOT NULL DEFAULT 'valid'")
  }

  const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>
  if (!nodeColumns.some((column) => column.name === 'content_revision')) {
    db.exec('ALTER TABLE nodes ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0')
  }
  if (!nodeColumns.some((column) => column.name === 'content_schema_version')) {
    db.exec('ALTER TABLE nodes ADD COLUMN content_schema_version INTEGER NOT NULL DEFAULT 0')
  }
  if (!nodeColumns.some((column) => column.name === 'content_updated_at')) {
    db.exec('ALTER TABLE nodes ADD COLUMN content_updated_at TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'vault_root')) {
    db.exec('ALTER TABLE nodes ADD COLUMN vault_root TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'file_path')) {
    db.exec('ALTER TABLE nodes ADD COLUMN file_path TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'file_kind')) {
    db.exec('ALTER TABLE nodes ADD COLUMN file_kind TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'content_hash')) {
    db.exec('ALTER TABLE nodes ADD COLUMN content_hash TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'document_content')) {
    db.exec('ALTER TABLE nodes ADD COLUMN document_content TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'tags_json')) {
    db.exec('ALTER TABLE nodes ADD COLUMN tags_json TEXT')
  }

  const versionColumns = db.prepare('PRAGMA table_info(node_versions)').all() as Array<{ name: string }>
  if (!versionColumns.some((column) => column.name === 'edit_session_id')) {
    db.exec('ALTER TABLE node_versions ADD COLUMN edit_session_id TEXT')
  }
  if (!versionColumns.some((column) => column.name === 'content_revision')) {
    db.exec('ALTER TABLE node_versions ADD COLUMN content_revision INTEGER')
  }
  if (!versionColumns.some((column) => column.name === 'updated_at')) {
    db.exec('ALTER TABLE node_versions ADD COLUMN updated_at TEXT')
  }
  if (!versionColumns.some((column) => column.name === 'document_content')) {
    db.exec('ALTER TABLE node_versions ADD COLUMN document_content TEXT')
  }
  // ai_response was historically also the editable body. Copy it once into
  // the new canonical column; after this migration the two fields may diverge.
  db.exec(`
    UPDATE nodes
    SET document_content = ai_response
    WHERE document_content IS NULL AND ai_response IS NOT NULL;
    UPDATE node_versions
    SET document_content = ai_response
    WHERE document_content IS NULL AND ai_response IS NOT NULL;
  `)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_edit_session
      ON node_versions(node_id, edit_session_id)
      WHERE edit_session_id IS NOT NULL;
  `)

  migrateMerges(db)

  // Kept here as well as schema.sql so an older database upgrades safely.
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_shares (
      id TEXT PRIMARY KEY,
      tree_id TEXT NOT NULL REFERENCES trees(id),
      node_id TEXT NOT NULL REFERENCES nodes(id),
      token_hash TEXT NOT NULL,
      token_hint TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_document_shares_tree ON document_shares(tree_id);
  `)

  const shareColumns = db.prepare('PRAGMA table_info(document_shares)').all() as Array<{ name: string }>
  if (!shareColumns.some((column) => column.name === 'node_id')) {
    db.exec('ALTER TABLE document_shares ADD COLUMN node_id TEXT REFERENCES nodes(id)')
  }
  db.exec(`
    UPDATE document_shares
    SET node_id = (SELECT root_node_id FROM trees WHERE trees.id = document_shares.tree_id)
    WHERE node_id IS NULL;
    DROP INDEX IF EXISTS idx_document_shares_active_tree;
    CREATE INDEX IF NOT EXISTS idx_document_shares_node ON document_shares(node_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_shares_active_node
      ON document_shares(node_id) WHERE is_enabled = 1;
  `)
}

function migrateMerges(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(merges)').all() as Array<{
    name: string
    notnull: 0 | 1
  }>
  const hasKind = columns.some((column) => column.name === 'kind')
  const hasDirection = columns.some((column) => column.name === 'direction')
  const landingSegment = columns.find((column) => column.name === 'landing_segment_id')
  if (hasKind && hasDirection && landingSegment?.notnull === 0) return

  const kindValue = hasKind ? "COALESCE(kind, 'summary')" : "'summary'"
  const directionValue = hasDirection ? 'direction' : 'NULL'
  db.transaction(() => {
    db.exec(`
      ALTER TABLE merges RENAME TO merges_before_correction;
      CREATE TABLE merges (
        id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL REFERENCES nodes(id),
        target_node_id TEXT NOT NULL REFERENCES nodes(id),
        conclusion TEXT NOT NULL,
        landing_segment_id TEXT REFERENCES context_segments(id),
        kind TEXT NOT NULL DEFAULT 'summary',
        direction TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO merges (
        id, source_node_id, target_node_id, conclusion,
        landing_segment_id, kind, direction, created_at
      )
      SELECT
        id, source_node_id, target_node_id, conclusion,
        landing_segment_id, ${kindValue}, ${directionValue}, created_at
      FROM merges_before_correction;
      DROP TABLE merges_before_correction;
    `)
  })()
}

export function openMemoryDb(): Db {
  return openDb(':memory:')
}
