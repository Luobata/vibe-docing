import type { ContextSegmentRow, MergeRow } from '@vibe/shared'
import { prosemirrorToPlainText } from '../context/prosemirror'
import type { AppDeps } from '../deps'
import type { Provider } from '../provider/types'

export class MergeNotFoundError extends Error {}
export class InvalidMergeError extends Error {}

export function createMergeService(
  deps: Pick<
    AppDeps,
    'context' | 'db' | 'merges' | 'nodes' | 'segments' | 'versions'
  >,
) {
  async function merge(input: {
    provider: Provider
    sourceNodeId: string
    targetNodeId: string
  }): Promise<{ merge: MergeRow; segment: ContextSegmentRow }> {
    const source = deps.nodes.get(input.sourceNodeId)
    const target = deps.nodes.get(input.targetNodeId)
    if (!source || source.is_deleted === 1) {
      throw new MergeNotFoundError(`active source node not found: ${input.sourceNodeId}`)
    }
    if (!target || target.is_deleted === 1) {
      throw new MergeNotFoundError(`active target node not found: ${input.targetNodeId}`)
    }
    if (source.parent_id !== target.id) {
      throw new InvalidMergeError('merge target must be the direct parent')
    }

    const messages = deps.context.assemble(source.id, source.user_input ?? '')
    const answer = prosemirrorToPlainText(source.ai_response)
    if (answer) messages.push({ content: answer, role: 'assistant' })
    messages.push({
      content: '请把以上子分支探索提炼成给父节点参考的简明结论。',
      role: 'user',
    })
    const conclusion = (await input.provider.complete(messages)).trim()
    if (!conclusion) throw new InvalidMergeError('provider returned an empty conclusion')

    return deps.db.transaction(() => {
      const segment = deps.segments.add({
        content: conclusion,
        nodeId: target.id,
        seq: deps.segments.nextSeq(target.id),
        type: 'merged-conclusion',
      })
      deps.versions.snapshot({
        aiResponse: target.ai_response,
        changeKind: 'merge',
        nodeId: target.id,
        userInput: target.user_input,
      })
      const merge = deps.merges.record({
        conclusion,
        landingSegmentId: segment.id,
        sourceNodeId: source.id,
        targetNodeId: target.id,
      })
      return { merge, segment }
    })()
  }

  return { merge }
}

