import type {
  ContextSegmentRow,
  NodeRow,
  SegmentType,
} from '@vibe/shared'
import { documentContentOf } from '@vibe/shared'
import { prosemirrorToPlainText } from './prosemirror'

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
  settings?: {
    get(key: string): string | undefined
  }
}

/** settings: context.ancestorFullDepth —— 距父节点最近 N 层祖先保留全文，更早的降为摘要。 */
const FULL_DEPTH_KEY = 'context.ancestorFullDepth'
const DEFAULT_FULL_DEPTH = 2
const SUMMARY_ANSWER_LEAD = 200

function readFullDepth(settings: BranchSegmentDeps['settings']): number {
  const configured = Number(settings?.get(FULL_DEPTH_KEY))
  return Number.isInteger(configured) && configured >= 0 && configured <= 10
    ? configured
    : DEFAULT_FULL_DEPTH
}

function firstLine(value: string | null): string {
  return value?.split('\n')[0]?.trim() ?? ''
}

/** 深层祖先的启发式摘要：问题首行 + 回答纯文本前导。不调 LLM，零成本可复现。 */
function ancestorDigest(node: NodeRow): string {
  const question = firstLine(node.user_input) || '（无提问）'
  const bodySource = documentContentOf(node) ?? node.ai_response
  const answer = prosemirrorToPlainText(bodySource).replace(/\s+/g, ' ').trim()
  const lead = answer.length > SUMMARY_ANSWER_LEAD ? `${answer.slice(0, SUMMARY_ANSWER_LEAD)}…` : answer
  return lead ? `${question}\n${lead}` : question
}

export function buildBranchSegments(
  deps: BranchSegmentDeps,
  input: { childNodeId: string; parentNodeId: string; seedText: string },
): void {
  const activePath = deps.nodes
    .getPathToRoot(input.parentNodeId)
    .filter((ancestor) => ancestor.is_deleted === 0)
  const fullDepth = readFullDepth(deps.settings)

  let seq = 0
  for (let index = 0; index < activePath.length; index += 1) {
    const ancestor = activePath[index]
    const distanceFromParent = activePath.length - 1 - index
    if (distanceFromParent < fullDepth) {
      deps.segments.add({
        nodeId: input.childNodeId,
        refNodeId: ancestor.id,
        refVersionNo: null,
        seq: seq++,
        type: 'ancestor-full',
      })
    } else {
      deps.segments.add({
        content: ancestorDigest(ancestor),
        nodeId: input.childNodeId,
        seq: seq++,
        type: 'ancestor-summary',
      })
    }
  }

  deps.segments.add({
    content: input.seedText,
    nodeId: input.childNodeId,
    seq,
    type: 'annotation-seed',
  })
}
