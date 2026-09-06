import type { MergeRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface RecordMergeInput {
  sourceNodeId: string
  targetNodeId: string
  conclusion: string
  direction?: string | null
  kind?: 'summary' | 'correction'
  landingSegmentId: string | null
}

export function createMergeRepo(db: Db, clock: Clock) {
  function findBySourceAndTarget(
    sourceNodeId: string,
    targetNodeId: string,
  ): MergeRow | undefined {
    return db.prepare(
      `SELECT * FROM merges
       WHERE source_node_id = ? AND target_node_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get(sourceNodeId, targetNodeId) as MergeRow | undefined
  }

  function record(input: RecordMergeInput): MergeRow {
    const id = newId()

    db.prepare(
      `INSERT INTO merges (
         id, source_node_id, target_node_id, conclusion,
         landing_segment_id, kind, direction, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sourceNodeId,
      input.targetNodeId,
      input.conclusion,
      input.landingSegmentId,
      input.kind ?? 'summary',
      input.direction ?? null,
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

  function listByTree(treeId: string): MergeRow[] {
    return db
      .prepare(
        `SELECT merges.* FROM merges
         JOIN nodes ON nodes.id = merges.target_node_id
         WHERE nodes.tree_id = ? AND nodes.is_deleted = 0
         ORDER BY merges.created_at ASC, merges.id ASC`,
      )
      .all(treeId) as MergeRow[]
  }

  return { findBySourceAndTarget, listByTarget, listByTree, record }
}
