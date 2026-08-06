import type {
  ContextSegmentRow,
  NodeRow,
  NodeVersionRow,
} from '@vibe/shared'

export interface ResolveSegmentDeps {
  nodes: {
    get(id: string): NodeRow | undefined
  }
  versions: {
    get(nodeId: string, versionNo: number): NodeVersionRow | undefined
  }
}

export type ResolvedSegment =
  | {
      aiResponse: string | null
      kind: 'ancestor'
      userInput: string | null
    }
  | { kind: 'skip' }
  | { kind: 'text'; text: string }

export function resolveSegmentContent(
  deps: ResolveSegmentDeps,
  segment: ContextSegmentRow,
): ResolvedSegment {
  if (segment.type !== 'ancestor-full') {
    return { kind: 'text', text: segment.content ?? '' }
  }

  if (!segment.ref_node_id) return { kind: 'skip' }
  const referencedNode = deps.nodes.get(segment.ref_node_id)
  if (!referencedNode || referencedNode.is_deleted === 1) return { kind: 'skip' }

  if (segment.ref_version_no !== null) {
    const version = deps.versions.get(segment.ref_node_id, segment.ref_version_no)
    if (!version) return { kind: 'skip' }
    return {
      aiResponse: version.ai_response,
      kind: 'ancestor',
      userInput: version.user_input,
    }
  }

  return {
    aiResponse: referencedNode.ai_response,
    kind: 'ancestor',
    userInput: referencedNode.user_input,
  }
}
