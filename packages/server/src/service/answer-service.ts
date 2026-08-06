import type { NodeRow } from '@vibe/shared'
import { assembleContext } from '../context/assemble'
import { plainTextToProseMirror } from '../context/prosemirror'
import type { Provider } from '../provider/types'
import type { createNodeRepo } from '../repo/node-repo'
import type { createSegmentRepo } from '../repo/segment-repo'
import type { createVersionRepo } from '../repo/version-repo'

type NodeRepo = ReturnType<typeof createNodeRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>

export interface GenerateAnswerInput {
  nodeId: string
  provider: Provider
  signal?: AbortSignal
  userInput: string
}

export function createAnswerService(deps: {
  nodes: NodeRepo
  segments: SegmentRepo
  versions: VersionRepo
}) {
  async function generate(
    input: GenerateAnswerInput,
    onChunk: (chunk: string) => void,
  ): Promise<NodeRow> {
    const existing = deps.nodes.get(input.nodeId)
    if (!existing || existing.is_deleted === 1) {
      throw new Error(`Active node not found: ${input.nodeId}`)
    }

    let accumulated = ''
    deps.nodes.updateContent(input.nodeId, {
      aiResponse: plainTextToProseMirror(accumulated),
      status: 'streaming',
      userInput: input.userInput,
    })

    try {
      const messages = assembleContext(deps, input.nodeId, input.userInput)
      for await (const chunk of input.provider.stream(messages, {
        signal: input.signal,
      })) {
        accumulated += chunk
        deps.nodes.updateContent(input.nodeId, {
          aiResponse: plainTextToProseMirror(accumulated),
          status: 'streaming',
        })
        onChunk(chunk)
      }

      const node = deps.nodes.updateContent(input.nodeId, {
        aiResponse: plainTextToProseMirror(accumulated),
        status: 'complete',
      })
      deps.versions.snapshot({
        aiResponse: node.ai_response,
        changeKind: 'regenerate',
        nodeId: node.id,
        userInput: node.user_input,
      })
      return node
    } catch (error) {
      const node = deps.nodes.updateContent(input.nodeId, {
        aiResponse: plainTextToProseMirror(accumulated),
        status: 'error',
      })
      deps.versions.snapshot({
        aiResponse: node.ai_response,
        changeKind: 'regenerate',
        nodeId: node.id,
        userInput: node.user_input,
      })
      throw error
    }
  }

  return { generate }
}
