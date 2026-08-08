import type { NodeRow } from '@vibe/shared'
import { assembleContext, type ChatMessage } from '../context/assemble'
import { plainTextToProseMirror } from '../context/prosemirror'
import type { Provider } from '../provider/types'
import type { createNodeRepo } from '../repo/node-repo'
import type { createSegmentRepo } from '../repo/segment-repo'
import type { createVersionRepo } from '../repo/version-repo'
import { dispatchTool, TOOL_SCHEMAS } from '../tools/fs-tools'
import { resolveProjectRoot } from '../tools/project-root'

type NodeRepo = ReturnType<typeof createNodeRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>

interface SettingsPort {
  getProjectRoot(): string | null
}

const MAX_TOOL_ROUNDS = 12

export interface GenerateAnswerInput {
  nodeId: string
  provider: Provider
  signal?: AbortSignal
  userInput: string
}

export function createAnswerService(deps: {
  nodes: NodeRepo
  segments: SegmentRepo
  settings: SettingsPort
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

    const complete = (): NodeRow => {
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
    }

    try {
      const messages = assembleContext(deps, input.nodeId, input.userInput)
      const rootResult = resolveProjectRoot(deps.settings.getProjectRoot())

      if ('root' in rootResult && typeof input.provider.streamWithTools === 'function') {
        return await runToolLoop(input, onChunk, messages, rootResult.root, complete)
      }

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

      return complete()
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

    /**
     * Tool-calling loop: let the model browse the local project via read-only fs
     * tools, then answer. 正文只写最终答复：每轮文本先缓冲，只有"本轮无 tool_call"
     * 的最终轮才 onChunk/累积进正文；中间轮的思考前言不写正文。
     */
    async function runToolLoop(
      loopInput: GenerateAnswerInput,
      emit: (chunk: string) => void,
      messages: ChatMessage[],
      root: string,
      finish: () => NodeRow,
    ): Promise<NodeRow> {
      const streamWithTools = loopInput.provider.streamWithTools!
      messages.push({
        content: `你可以调用工具浏览本地项目根目录：${root}。需要时先读取文件再作答。`,
        role: 'system',
      })

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let roundText = ''
        const toolCalls: { arguments: string; id: string; name: string }[] = []
        for await (const event of streamWithTools(messages, TOOL_SCHEMAS, {
          signal: loopInput.signal,
        })) {
          if (event.type === 'text') {
            roundText += event.text
          } else {
            toolCalls.push({
              arguments: event.arguments,
              id: event.id,
              name: event.name,
            })
          }
        }

        if (toolCalls.length === 0) {
          // 最终轮：把缓冲的文本一次性作为正文提交并流出。
          accumulated = roundText
          deps.nodes.updateContent(loopInput.nodeId, {
            aiResponse: plainTextToProseMirror(accumulated),
            status: 'streaming',
          })
          emit(roundText)
          return finish()
        }

        // 中间轮：追加 assistant(tool_calls) 与每个工具的执行结果，继续循环。
        messages.push({
          content: roundText,
          role: 'assistant',
          tool_calls: toolCalls.map((call) => ({
            function: { arguments: call.arguments, name: call.name },
            id: call.id,
            type: 'function',
          })),
        })
        for (const call of toolCalls) {
          messages.push({
            content: dispatchTool(root, call.name, call.arguments),
            role: 'tool',
            tool_call_id: call.id,
          })
        }
      }

      // 达到轮数上限仍未收尾：提示模型基于已有信息作答，做一次单轮兜底流。
      messages.push({
        content: '工具调用轮数已达上限，请基于已有信息作答。',
        role: 'system',
      })
      for await (const chunk of loopInput.provider.stream(messages, {
        signal: loopInput.signal,
      })) {
        accumulated += chunk
        deps.nodes.updateContent(loopInput.nodeId, {
          aiResponse: plainTextToProseMirror(accumulated),
          status: 'streaming',
        })
        emit(chunk)
      }
      return finish()
    }
  }

  return { generate }
}
