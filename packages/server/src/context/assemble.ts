import type {
  ContextSegmentRow,
  NodeRow,
  NodeVersionRow,
} from '@vibe/shared'
import { prosemirrorToPlainText } from './prosemirror'
import { resolveSegmentContent } from './resolve-segment'

export interface ChatMessage {
  content: string
  role: 'system' | 'user' | 'assistant'
}

export interface AssembleContextDeps {
  nodes: {
    get(id: string): NodeRow | undefined
  }
  segments: {
    listByNode(nodeId: string): ContextSegmentRow[]
  }
  versions: {
    get(nodeId: string, versionNo: number): NodeVersionRow | undefined
  }
}

const textPrefixes = {
  'ancestor-summary': '[祖先摘要] ',
  'annotation-seed': '[聚焦] ',
  'merged-conclusion': '[已并入结论] ',
} as const

export function assembleContext(
  deps: AssembleContextDeps,
  nodeId: string,
  currentUserInput: string,
): ChatMessage[] {
  const messages: ChatMessage[] = []
  const orderedSegments = [...deps.segments.listByNode(nodeId)].sort(
    (left, right) => left.seq - right.seq,
  )

  for (const segment of orderedSegments) {
    const resolved = resolveSegmentContent(
      { nodes: deps.nodes, versions: deps.versions },
      segment,
    )
    if (resolved.kind === 'skip') continue
    if (resolved.kind === 'ancestor') {
      if (resolved.userInput) {
        messages.push({ content: resolved.userInput, role: 'user' })
      }
      const answer = prosemirrorToPlainText(resolved.aiResponse)
      if (answer) messages.push({ content: answer, role: 'assistant' })
      continue
    }

    if (!resolved.text) continue
    const prefix = textPrefixes[segment.type as keyof typeof textPrefixes]
    messages.push({ content: `${prefix ?? ''}${resolved.text}`, role: 'user' })
  }

  messages.push({ content: currentUserInput, role: 'user' })
  return messages
}
