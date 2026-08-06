import type { AnnotationKind, AnnotationRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

interface CreateAnnotationInput {
  nodeId: string
  kind: AnnotationKind
  anchorFrom?: number | null
  anchorTo?: number | null
  quotedText?: string | null
  note?: string | null
}

export function createAnnotationRepo(db: Db, clock: Clock) {
  function get(id: string): AnnotationRow | undefined {
    return db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as
      | AnnotationRow
      | undefined
  }

  function create(input: CreateAnnotationInput): AnnotationRow {
    const id = newId()

    db.prepare(
      `INSERT INTO annotations (
         id, node_id, kind, anchor_from, anchor_to, quoted_text,
         note, child_node_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      input.kind,
      input.anchorFrom ?? null,
      input.anchorTo ?? null,
      input.quotedText ?? null,
      input.note ?? null,
      null,
      clock.now(),
    )

    return get(id)!
  }

  function linkChild(annotationId: string, childNodeId: string): void {
    db.prepare('UPDATE annotations SET child_node_id = ? WHERE id = ?').run(
      childNodeId,
      annotationId,
    )
  }

  function listByNode(nodeId: string): AnnotationRow[] {
    return db
      .prepare(
        `SELECT * FROM annotations
         WHERE node_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(nodeId) as AnnotationRow[]
  }

  return { create, get, linkChild, listByNode }
}
