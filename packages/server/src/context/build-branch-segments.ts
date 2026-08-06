import type {
  ContextSegmentRow,
  NodeRow,
  SegmentType,
} from '@vibe/shared'

export interface BranchSegmentInput {
  content?: string | null
  nodeId: string
  refNodeId?: string | null
  refVersionNo?: number | null
  seq: number
  type: SegmentType
}

export interface BranchSegmentDeps {
  nodes: {
    getPathToRoot(nodeId: string): NodeRow[]
  }
  segments: {
    add(input: BranchSegmentInput): ContextSegmentRow
  }
}

export function buildBranchSegments(
  deps: BranchSegmentDeps,
  input: { childNodeId: string; parentNodeId: string; seedText: string },
): void {
  const activePath = deps.nodes
    .getPathToRoot(input.parentNodeId)
    .filter((ancestor) => ancestor.is_deleted === 0)

  let seq = 0
  for (const ancestor of activePath) {
    deps.segments.add({
      nodeId: input.childNodeId,
      refNodeId: ancestor.id,
      refVersionNo: null,
      seq: seq++,
      type: 'ancestor-full',
    })
  }

  deps.segments.add({
    content: input.seedText,
    nodeId: input.childNodeId,
    seq,
    type: 'annotation-seed',
  })
}
