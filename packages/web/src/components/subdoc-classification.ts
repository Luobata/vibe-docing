import type { AnnotationRow } from '@vibe/shared'

export interface SubdocGroups {
  contextual: string[]
  global: string[]
}

export function isSelectionSource(annotation: AnnotationRow | undefined): annotation is AnnotationRow {
  return annotation?.kind !== 'whole' &&
    annotation?.anchor_from !== null && annotation?.anchor_from !== undefined &&
    annotation.anchor_to !== null && annotation.anchor_to !== undefined
}

export function groupSubdocIds(
  nodeIds: string[],
  annotations: AnnotationRow[],
): SubdocGroups {
  const sourceByChildId = new Map(
    annotations.flatMap((annotation) => annotation.child_node_id
      ? [[annotation.child_node_id, annotation] as const]
      : []),
  )
  const groups: SubdocGroups = { contextual: [], global: [] }

  for (const nodeId of nodeIds) {
    const source = sourceByChildId.get(nodeId)
    // Keep legacy children whose source annotation is unavailable in the
    // original branch group so old data never disappears after this split.
    if (!source || isSelectionSource(source)) groups.contextual.push(nodeId)
    else groups.global.push(nodeId)
  }

  return groups
}
