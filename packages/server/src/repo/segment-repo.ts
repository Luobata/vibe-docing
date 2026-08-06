import type { ContextSegmentRow, SegmentType } from '@vibe/shared'
import type { Db } from '../db/connection'
import { newId } from '../util/ids'

interface AddSegmentInput {
  nodeId: string
  seq: number
  type: SegmentType
  refNodeId?: string | null
  refVersionNo?: number | null
  content?: string | null
}

export function createSegmentRepo(db: Db) {
  function add(input: AddSegmentInput): ContextSegmentRow {
    const id = newId()

    db.prepare(
      `INSERT INTO context_segments (
         id, node_id, seq, type, ref_node_id, ref_version_no, content
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      input.seq,
      input.type,
      input.refNodeId ?? null,
      input.refVersionNo ?? null,
      input.content ?? null,
    )

    return db
      .prepare('SELECT * FROM context_segments WHERE id = ?')
      .get(id) as ContextSegmentRow
  }

  function listByNode(nodeId: string): ContextSegmentRow[] {
    return db
      .prepare(
        `SELECT * FROM context_segments
         WHERE node_id = ?
         ORDER BY seq ASC, id ASC`,
      )
      .all(nodeId) as ContextSegmentRow[]
  }

  function nextSeq(nodeId: string): number {
    const { nextSequence } = db
      .prepare(
        `SELECT COALESCE(MAX(seq) + 1, 0) AS nextSequence
         FROM context_segments
         WHERE node_id = ?`,
      )
      .get(nodeId) as { nextSequence: number }

    return nextSequence
  }

  return { add, listByNode, nextSeq }
}
