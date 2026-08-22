import type { ChangeKind, NodeVersionRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface SnapshotInput {
  nodeId: string
  userInput: string | null
  aiResponse: string | null
  documentContent?: string | null
  changeKind: ChangeKind
  contentRevision?: number | null
  editSessionId?: string | null
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
         id, node_id, version_no, user_input, ai_response, document_content, change_kind,
         edit_session_id, content_revision, updated_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      nextVersion,
      input.userInput,
      input.aiResponse,
      input.documentContent !== undefined ? input.documentContent : input.aiResponse,
      input.changeKind,
      input.editSessionId ?? null,
      input.contentRevision ?? null,
      clock.now(),
      clock.now(),
    )

    return db.prepare('SELECT * FROM node_versions WHERE id = ?').get(id) as NodeVersionRow
  })

  function snapshot(input: SnapshotInput): NodeVersionRow {
    return insertSnapshot(input)
  }

  function snapshotEditSession(input: SnapshotInput & { editSessionId: string }): NodeVersionRow {
    const existing = db.prepare(
      `SELECT id FROM node_versions
       WHERE node_id = ? AND edit_session_id = ?`,
    ).get(input.nodeId, input.editSessionId) as { id: string } | undefined
    if (!existing) return insertSnapshot({ ...input, changeKind: 'edit' })

    db.prepare(
      `UPDATE node_versions
       SET user_input = ?, ai_response = ?, document_content = ?, content_revision = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.userInput,
      input.aiResponse,
      input.documentContent !== undefined ? input.documentContent : input.aiResponse,
      input.contentRevision ?? null,
      clock.now(),
      existing.id,
    )
    return db.prepare('SELECT * FROM node_versions WHERE id = ?').get(existing.id) as NodeVersionRow
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

  return { snapshot, snapshotEditSession, listByNode, get }
}
