import type { ContextSegmentRow, NodeRow } from '@vibe/shared'
import {
  assembleContext,
  type AssembleContextDeps,
  type ChatMessage,
} from './assemble'
import {
  buildBranchSegments,
  type BranchSegmentInput,
} from './build-branch-segments'
import { resolveSegmentContent } from './resolve-segment'

export type ContextEngineDeps = AssembleContextDeps & {
  nodes: AssembleContextDeps['nodes'] & {
    getPathToRoot(nodeId: string): NodeRow[]
  }
  segments: AssembleContextDeps['segments'] & {
    add(input: BranchSegmentInput): ContextSegmentRow
  }
}

export function createContextEngine(deps: ContextEngineDeps) {
  return {
    assemble(nodeId: string, currentUserInput: string): ChatMessage[] {
      return assembleContext(deps, nodeId, currentUserInput)
    },
    buildBranch(input: {
      childNodeId: string
      parentNodeId: string
      seedText: string
    }): void {
      buildBranchSegments(deps, input)
    },
    resolve(segment: ContextSegmentRow) {
      return resolveSegmentContent(deps, segment)
    },
  }
}

export type ContextEngine = ReturnType<typeof createContextEngine>
