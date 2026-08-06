import type { MergeRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface RecordMergeInput {
  sourceNodeId: string
  targetNodeId: string
  conclusion: string
  landingSegmentId: string
}

export function createMergeRepo(db: Db, clock: Clock) {
  function record(input: RecordMergeInput): MergeRow {
    const id = newId()

    db.prepare(
      `INSERT INTO merges (
         id, source_node_id, target_node_id, conclusion,
         landing_segment_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sourceNodeId,
      input.targetNodeId,
      input.conclusion,
      input.landingSegmentId,
      clock.now(),
    )

    return db.prepare('SELECT * FROM merges WHERE id = ?').get(id) as MergeRow
  }

  function listByTarget(targetNodeId: string): MergeRow[] {
    return db
      .prepare(
        `SELECT * FROM merges
         WHERE target_node_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(targetNodeId) as MergeRow[]
  }

  return { record, listByTarget }
}
