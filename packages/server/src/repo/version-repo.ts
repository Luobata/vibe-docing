import type { ChangeKind, NodeVersionRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface SnapshotInput {
  nodeId: string
  userInput: string | null
  aiResponse: string | null
  changeKind: ChangeKind
}

export function createVersionRepo(db: Db, clock: Clock) {
  const insertSnapshot = db.transaction((input: SnapshotInput) => {
    const id = newId()
    const { nextVersion } = db
      .prepare(
        `SELECT COALESCE(MAX(version_no) + 1, 1) AS nextVersion
         FROM node_versions
         WHERE node_id = ?`,
      )
      .get(input.nodeId) as { nextVersion: number }

    db.prepare(
      `INSERT INTO node_versions (
         id, node_id, version_no, user_input, ai_response, change_kind, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      nextVersion,
      input.userInput,
      input.aiResponse,
      input.changeKind,
      clock.now(),
    )

    return db.prepare('SELECT * FROM node_versions WHERE id = ?').get(id) as NodeVersionRow
  })

  function snapshot(input: SnapshotInput): NodeVersionRow {
    return insertSnapshot(input)
  }

  function listByNode(nodeId: string): NodeVersionRow[] {
    return db
      .prepare(
        `SELECT * FROM node_versions
         WHERE node_id = ?
         ORDER BY version_no ASC`,
      )
      .all(nodeId) as NodeVersionRow[]
  }

  function get(nodeId: string, versionNo: number): NodeVersionRow | undefined {
    return db
      .prepare(
        `SELECT * FROM node_versions
         WHERE node_id = ? AND version_no = ?`,
      )
      .get(nodeId, versionNo) as NodeVersionRow | undefined
  }

  return { snapshot, listByNode, get }
}
