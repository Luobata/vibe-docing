import { sanitizeTagList, type NodeRow, type NodeStatus } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface CreateNodeInput {
  treeId: string
  parentId: string | null
  userInput?: string | null
  status?: NodeStatus
}

interface UpdateNodeContentPatch {
  userInput?: string | null
  aiResponse?: string | null
  documentContent?: string | null
  status?: NodeStatus
  contentSchemaVersion?: 0 | 1 | 2
}

export function createNodeRepo(db: Db, clock: Clock) {
  function get(id: string): NodeRow | undefined {
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as
      | NodeRow
      | undefined
  }

  function create(input: CreateNodeInput): NodeRow {
    const id = newId()
    const now = clock.now()
    const { nextSortOrder } = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order) + 1, 0) AS nextSortOrder
         FROM nodes
         WHERE tree_id = ? AND parent_id IS ?`,
      )
      .get(input.treeId, input.parentId) as { nextSortOrder: number }

    db.prepare(
      `INSERT INTO nodes (
         id, tree_id, parent_id, sort_order, user_input, ai_response,
         status, is_deleted, model_override, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.treeId,
      input.parentId,
      nextSortOrder,
      input.userInput ?? null,
      null,
      input.status ?? 'draft',
      0,
      null,
      now,
      now,
    )

    return get(id)!
  }

  function getChildren(parentId: string): NodeRow[] {
    return db
      .prepare(
        `SELECT * FROM nodes
         WHERE parent_id = ? AND is_deleted = 0
         ORDER BY sort_order ASC, id ASC`,
      )
      .all(parentId) as NodeRow[]
  }

  function getPathToRoot(nodeId: string): NodeRow[] {
    const path: NodeRow[] = []
    let current = get(nodeId)

    while (current) {
      path.unshift(current)
      current = current.parent_id ? get(current.parent_id) : undefined
    }

    return path
  }

  function updateContent(id: string, patch: UpdateNodeContentPatch): NodeRow {
    const current = get(id)
    if (!current) {
      throw new Error(`Node not found: ${id}`)
    }

    const now = clock.now()
    const changesDocument = patch.documentContent !== undefined
    db.prepare(
      `UPDATE nodes
       SET user_input = ?, ai_response = ?, document_content = ?, status = ?, updated_at = ?,
           content_revision = content_revision + ?,
           content_schema_version = ?,
           content_updated_at = CASE WHEN ? = 1 THEN ? ELSE content_updated_at END
       WHERE id = ?`,
    ).run(
      patch.userInput !== undefined ? patch.userInput : current.user_input,
      patch.aiResponse !== undefined ? patch.aiResponse : current.ai_response,
      patch.documentContent !== undefined ? patch.documentContent : current.document_content ?? null,
      patch.status ?? current.status,
      now,
      changesDocument ? 1 : 0,
      patch.contentSchemaVersion ?? current.content_schema_version ?? 0,
      changesDocument ? 1 : 0,
      now,
      id,
    )

    return get(id)!
  }

  function updateGeneration(id: string, patch: {
    aiResponse: string
    status?: NodeStatus
    userInput?: string | null
  }): NodeRow {
    return updateContent(id, {
      aiResponse: patch.aiResponse,
      documentContent: patch.aiResponse,
      status: patch.status,
      userInput: patch.userInput,
    })
  }

  function updateTags(id: string, tags: unknown[]): NodeRow {
    const clean = sanitizeTagList(tags)
    db.prepare('UPDATE nodes SET tags_json = ?, updated_at = ? WHERE id = ?').run(
      clean.length > 0 ? JSON.stringify(clean) : null,
      clock.now(),
      id,
    )
    return get(id)!
  }


  function updateDocumentContent(input: {
    baseRevision: number
    content: string
    id: string
    schemaVersion: 1 | 2
  }): NodeRow | undefined {
    const now = clock.now()
    const result = db.prepare(
      `UPDATE nodes
       SET document_content = ?, content_revision = content_revision + 1,
           content_schema_version = ?, content_updated_at = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0 AND content_revision = ?`,
    ).run(
      input.content,
      input.schemaVersion,
      now,
      now,
      input.id,
      input.baseRevision,
    )
    return result.changes === 1 ? get(input.id) : undefined
  }

  function setVaultFile(input: {
    contentHash: string
    fileKind: 'markdown' | 'canvas' | 'base'
    filePath: string
    id: string
    vaultRoot: string
  }): NodeRow {
    db.prepare(
      `UPDATE nodes
       SET vault_root = ?, file_path = ?, file_kind = ?, content_hash = ?
       WHERE id = ?`,
    ).run(input.vaultRoot, input.filePath, input.fileKind, input.contentHash, input.id)
    return get(input.id)!
  }

  function syncExternalContent(input: {
    content: string
    contentHash: string
    fileKind: 'markdown' | 'canvas' | 'base'
    id: string
  }): NodeRow {
    const current = get(input.id)
    if (!current) throw new Error(`Node not found: ${input.id}`)
    if (current.content_hash === input.contentHash
      && current.document_content === input.content
      && current.content_schema_version === 2) return current
    const now = clock.now()
    db.prepare(
      `UPDATE nodes
       SET document_content = ?, content_hash = ?, file_kind = ?,
           content_schema_version = 2, content_revision = content_revision + 1,
           content_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.content, input.contentHash, input.fileKind, now, now, input.id)
    return get(input.id)!
  }

  function setDeleted(id: string, isDeleted: 0 | 1): void {
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id
         FROM nodes
         JOIN subtree ON nodes.parent_id = subtree.id
       )
       UPDATE nodes
       SET is_deleted = ?, updated_at = ?
       WHERE id IN (SELECT id FROM subtree)`,
    ).run(id, isDeleted, clock.now())
  }

  function softDelete(id: string): void {
    setDeleted(id, 1)
  }

  function restore(id: string): void {
    // Restoring a descendant below a still-deleted parent would make it
    // disappear from both the tree and the trash. Bring back its ancestor path
    // as well as the selected subtree so every restored node is reachable.
    db.prepare(
      `WITH RECURSIVE
       ancestors(id, parent_id) AS (
         SELECT id, parent_id FROM nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id, nodes.parent_id
         FROM nodes
         JOIN ancestors ON ancestors.parent_id = nodes.id
       ),
       subtree(id) AS (
         SELECT id FROM nodes WHERE id = ?
         UNION ALL
         SELECT nodes.id
         FROM nodes
         JOIN subtree ON nodes.parent_id = subtree.id
       )
       UPDATE nodes
       SET is_deleted = 0, updated_at = ?
       WHERE id IN (SELECT id FROM ancestors)
          OR id IN (SELECT id FROM subtree)`,
    ).run(id, id, clock.now())
  }

  function listDeleted(treeId: string): NodeRow[] {
    return db
      .prepare(
        `SELECT * FROM nodes
         WHERE tree_id = ? AND is_deleted = 1
         ORDER BY created_at ASC, sort_order ASC, id ASC`,
      )
      .all(treeId) as NodeRow[]
  }

  return {
    create,
    get,
    getChildren,
    getPathToRoot,
    setVaultFile,
    syncExternalContent,
    updateContent,
    updateDocumentContent,
    updateGeneration,
    updateTags,
    softDelete,
    restore,
    listDeleted,
  }
}
