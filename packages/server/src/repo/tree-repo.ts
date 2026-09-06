import type { NodeRow, TreeRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export function createTreeRepo(db: Db, clock: Clock) {
  function get(id: string): TreeRow | undefined {
    return db.prepare('SELECT * FROM trees WHERE id = ? AND is_deleted = 0').get(id) as
      | TreeRow
      | undefined
  }

  function getNode(id: string): NodeRow | undefined {
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as
      | NodeRow
      | undefined
  }

  const insertTreeWithRoot = db.transaction(
    (treeId: string, rootId: string, title: string, now: string) => {
      db.prepare(
        `INSERT INTO trees (id, title, root_node_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(treeId, title, rootId, now, now)
      db.prepare(
        `INSERT INTO nodes (
           id, tree_id, parent_id, sort_order, user_input, ai_response,
           status, is_deleted, model_override, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(rootId, treeId, null, 0, null, null, 'complete', 0, null, now, now)
    },
  )

  function create(title: string): { tree: TreeRow; rootNode: NodeRow } {
    const now = clock.now()
    const treeId = newId()
    const rootId = newId()

    insertTreeWithRoot(treeId, rootId, title, now)

    return {
      tree: get(treeId)!,
      rootNode: getNode(rootId)!,
    }
  }

  function list(): TreeRow[] {
    return db
      .prepare('SELECT * FROM trees WHERE is_deleted = 0 ORDER BY updated_at DESC, id ASC')
      .all() as TreeRow[]
  }

  function listDeleted(): TreeRow[] {
    return db
      .prepare('SELECT * FROM trees WHERE is_deleted = 1 ORDER BY updated_at DESC, id ASC')
      .all() as TreeRow[]
  }

  function softDelete(id: string): void {
    db.prepare('UPDATE trees SET is_deleted = 1, updated_at = ? WHERE id = ?')
      .run(clock.now(), id)
  }

  function rename(id: string, title: string): TreeRow | undefined {
    db.prepare('UPDATE trees SET title = ?, updated_at = ? WHERE id = ? AND is_deleted = 0')
      .run(title, clock.now(), id)
    return get(id)
  }

  /** 笔记库归入文件夹；folder 为 null 表示未分组。清洗规则与笔记目录一致。 */
  function setFolder(id: string, folder: string | null): TreeRow | undefined {
    db.prepare('UPDATE trees SET folder = ?, updated_at = ? WHERE id = ? AND is_deleted = 0')
      .run(folder, clock.now(), id)
    return get(id)
  }

  function restore(id: string): TreeRow | undefined {
    const result = db
      .prepare('UPDATE trees SET is_deleted = 0, updated_at = ? WHERE id = ? AND is_deleted = 1')
      .run(clock.now(), id)
    return result.changes === 1 ? get(id) : undefined
  }

  return { create, get, list, listDeleted, rename, restore, setFolder, softDelete }
}
