import type { AnnotationRow } from '@vibe/shared'

type AnchorTarget = { kind: 'branch'; childNodeId: string } | { kind: 'note'; annotationId: string } | null

function overlaps(a: AnnotationRow, from: number, to: number): boolean {
  if (a.anchor_from === null || a.anchor_to === null) return false
  return a.anchor_from < to && a.anchor_to > from
}

export function pickAnchorTarget(
  annotations: AnnotationRow[],
  clickedId: string,
  isBranchLive?: (childNodeId: string) => boolean,
): AnchorTarget {
  const clicked = annotations.find((a) => a.id === clickedId)
  if (!clicked || clicked.anchor_from === null || clicked.anchor_to === null) return null
  const covering = annotations.filter((a) => overlaps(a, clicked.anchor_from!, clicked.anchor_to!))
  const byOrder = (x: AnnotationRow, y: AnnotationRow) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id)
  const branches = covering
    .filter((a) => a.child_node_id && (!isBranchLive || isBranchLive(a.child_node_id)))
    .sort(byOrder)
  if (branches.length) return { kind: 'branch', childNodeId: branches[0].child_node_id! }
  const notes = covering.filter((a) => !a.child_node_id && a.note).sort(byOrder)
  if (notes.length) return { kind: 'note', annotationId: notes[0].id }
  return null
}
