import type { AnnotationKind, AnnotationRow, VisualAnnotationTarget } from '@vibe/shared'
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
  visualTarget?: VisualAnnotationTarget | null
}

type AnnotationDbRow = Omit<AnnotationRow, 'visual_target'> & { visual_target_json: string | null }

function hydrate(row: AnnotationDbRow): AnnotationRow {
  const { visual_target_json: visualTargetJson, ...annotation } = row
  return {
    ...annotation,
    visual_target: visualTargetJson ? JSON.parse(visualTargetJson) as VisualAnnotationTarget : null,
  }
}

export function createAnnotationRepo(db: Db, clock: Clock) {
  function get(id: string): AnnotationRow | undefined {
    const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as AnnotationDbRow | undefined
    return row ? hydrate(row) : undefined
  }

  function create(input: CreateAnnotationInput): AnnotationRow {
    const id = newId()

    db.prepare(
      `INSERT INTO annotations (
         id, node_id, kind, anchor_from, anchor_to, quoted_text,
         note, child_node_id, visual_target_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.nodeId,
      input.kind,
      input.anchorFrom ?? null,
      input.anchorTo ?? null,
      input.quotedText ?? null,
      input.note ?? null,
      null,
      input.visualTarget ? JSON.stringify(input.visualTarget) : null,
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
    const rows = db
      .prepare(
        `SELECT * FROM annotations
         WHERE node_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(nodeId) as AnnotationDbRow[]
    return rows.map(hydrate)
  }

  return { create, get, linkChild, listByNode }
}
