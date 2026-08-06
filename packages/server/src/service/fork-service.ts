import type { AnnotationKind } from '@vibe/shared'
import type { AppDeps } from '../deps'

export interface ForkInput {
  anchorFrom?: number | null
  anchorTo?: number | null
  kind: AnnotationKind
  note?: string | null
  parentNodeId: string
  quotedText?: string | null
  seedText: string
  treeId: string
}

export function createForkService(
  deps: Pick<AppDeps, 'annotations' | 'context' | 'db' | 'nodes'>,
) {
  const forkTransaction = deps.db.transaction((input: ForkInput) => {
    const parent = deps.nodes.get(input.parentNodeId)
    if (!parent || parent.is_deleted === 1) throw new Error('parent node not found')
    if (parent.tree_id !== input.treeId) throw new Error('parent tree mismatch')

    const annotation = deps.annotations.create({
      anchorFrom: input.anchorFrom ?? null,
      anchorTo: input.anchorTo ?? null,
      kind: input.kind,
      nodeId: parent.id,
      note: input.note ?? null,
      quotedText: input.quotedText ?? null,
    })
    const childNode = deps.nodes.create({
      parentId: parent.id,
      status: 'draft',
      treeId: parent.tree_id,
    })
    deps.annotations.linkChild(annotation.id, childNode.id)
    deps.context.buildBranch({
      childNodeId: childNode.id,
      parentNodeId: parent.id,
      seedText: input.seedText,
    })

    return {
      annotation: deps.annotations.get(annotation.id)!,
      childNode,
    }
  })

  return {
    fork(input: ForkInput) {
      return forkTransaction(input)
    },
  }
}
