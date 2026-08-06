import type { NodeRow, NodeStatus } from '@vibe/shared'
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
  status?: NodeStatus
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

    db.prepare(
      `UPDATE nodes
       SET user_input = ?, ai_response = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.userInput !== undefined ? patch.userInput : current.user_input,
      patch.aiResponse !== undefined ? patch.aiResponse : current.ai_response,
      patch.status ?? current.status,
      clock.now(),
      id,
    )

    return get(id)!
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
    setDeleted(id, 0)
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
    updateContent,
    softDelete,
    restore,
    listDeleted,
  }
}
