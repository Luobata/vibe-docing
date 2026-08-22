import { normalizeFencedCodeBlocks, type NodeRow, type VisualReference, type VisualStreamEvent } from '@vibe/shared'
import { assembleContext, type ChatMessage } from '../context/assemble'
import { plainTextToProseMirror } from '../context/prosemirror'
import type { Provider } from '../provider/types'
import type { createNodeRepo } from '../repo/node-repo'
import type { createSegmentRepo } from '../repo/segment-repo'
import type { createVersionRepo } from '../repo/version-repo'
import type { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { CREATE_VISUAL_TOOL_SCHEMA, createVisualArtifactFromTool } from '../tools/create-visual'
import { dispatchTool, TOOL_SCHEMAS } from '../tools/fs-tools'
import { resolveProjectRoot } from '../tools/project-root'
import { newId } from '../util/ids'

type NodeRepo = ReturnType<typeof createNodeRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>
type VisualArtifactRepo = ReturnType<typeof createVisualArtifactRepo>

interface SettingsPort {
  getProjectRoot(): string | null
}

const MAX_TOOL_ROUNDS = 12

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
}

function answerToProseMirror(text: string, references: VisualReference[]): string {
  const document = JSON.parse(plainTextToProseMirror(normalizeFencedCodeBlocks(text))) as {
    content?: Array<Record<string, unknown>>
    type: string
  }
  return JSON.stringify({
    ...document,
    content: [
      ...(document.content ?? []),
      ...references.map((reference) => ({ attrs: reference, type: 'visual_ref' })),
    ],
  })
}

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
  visualArtifacts: VisualArtifactRepo
}) {
  async function generate(
    input: GenerateAnswerInput,
    onChunk: (chunk: string) => void,
    onVisual: (event: VisualStreamEvent) => void = () => {},
  ): Promise<NodeRow> {
    const existing = deps.nodes.get(input.nodeId)
    if (!existing || existing.is_deleted === 1) {
      throw new Error(`Active node not found: ${input.nodeId}`)
    }

    let accumulated = ''
    const visualReferences: VisualReference[] = []
    deps.nodes.updateGeneration(input.nodeId, {
      aiResponse: answerToProseMirror(accumulated, visualReferences),
      status: 'streaming',
      userInput: input.userInput,
    })

    const complete = (): NodeRow => {
      const node = deps.nodes.updateGeneration(input.nodeId, {
        aiResponse: answerToProseMirror(accumulated, visualReferences),
        status: 'complete',
      })
      deps.versions.snapshot({
        aiResponse: node.ai_response,
        documentContent: node.document_content ?? null,
        changeKind: 'regenerate',
        nodeId: node.id,
        userInput: node.user_input,
      })
      return node
    }

    try {
      const messages = assembleContext(deps, input.nodeId, input.userInput)
      const rootResult = resolveProjectRoot(deps.settings.getProjectRoot())

      if (typeof input.provider.streamWithTools === 'function') {
        return await runToolLoop(input, onChunk, onVisual, messages, 'root' in rootResult ? rootResult.root : undefined, complete)
      }

      for await (const chunk of input.provider.stream(messages, {
        signal: input.signal,
      })) {
        input.signal?.throwIfAborted()
        accumulated += chunk
        deps.nodes.updateGeneration(input.nodeId, {
          aiResponse: answerToProseMirror(accumulated, visualReferences),
          status: 'streaming',
        })
        onChunk(chunk)
      }

      input.signal?.throwIfAborted()
      return complete()
    } catch (error) {
      if (isAbortError(error, input.signal)) {
        deps.nodes.updateGeneration(input.nodeId, {
          aiResponse: answerToProseMirror(accumulated, visualReferences),
          status: 'cancelled',
        })
        throw error
      }
      const node = deps.nodes.updateGeneration(input.nodeId, {
        aiResponse: answerToProseMirror(accumulated, visualReferences),
        status: 'error',
      })
      deps.versions.snapshot({
        aiResponse: node.ai_response,
        documentContent: node.document_content ?? null,
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
      emitVisual: (event: VisualStreamEvent) => void,
      messages: ChatMessage[],
      root: string | undefined,
      finish: () => NodeRow,
    ): Promise<NodeRow> {
      const streamWithTools = loopInput.provider.streamWithTools!
      const tools = root ? [...TOOL_SCHEMAS, CREATE_VISUAL_TOOL_SCHEMA] : [CREATE_VISUAL_TOOL_SCHEMA]
      messages.push({
        content: [
          root ? `你可以调用工具浏览本地项目根目录：${root}。需要时先读取文件再作答。` : '',
          '当层级、流程、时序或至少三个依赖关系用图更清晰时，可以主动调用 create_visual；单次回答默认最多 1～2 张图。',
          '只能提交结构化 scene，禁止 JavaScript、脚本、HTML、事件处理器和外链；创建失败时必须用文字降级。',
        ].filter(Boolean).join('\n'),
        role: 'system',
      })
      let visualCount = 0

      const commitTextChunks = (chunks: string[]): void => {
        for (const chunk of chunks) {
          accumulated += chunk
          deps.nodes.updateGeneration(loopInput.nodeId, {
            aiResponse: answerToProseMirror(accumulated, visualReferences),
            status: 'streaming',
          })
          emit(chunk)
        }
      }

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let roundText = ''
        const roundChunks: string[] = []
        const toolCalls: { arguments: string; id: string; name: string }[] = []
        try {
          for await (const event of streamWithTools(messages, tools, {
            signal: loopInput.signal,
          })) {
            loopInput.signal?.throwIfAborted()
            if (event.type === 'text') {
              roundText += event.text
              roundChunks.push(event.text)
            } else {
              toolCalls.push({
                arguments: event.arguments,
                id: event.id,
                name: event.name,
              })
            }
          }
        } catch (error) {
          if (toolCalls.length === 0) commitTextChunks(roundChunks)
          throw error
        }

        loopInput.signal?.throwIfAborted()
        if (toolCalls.length === 0) {
          // 最终轮：把缓冲的文本一次性作为正文提交并流出。
          accumulated = ''
          commitTextChunks(roundChunks)
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
          loopInput.signal?.throwIfAborted()
          if (call.name === 'create_visual') {
            const placeholderId = newId()
            const artifactId = newId()
            const revision = 1
            emitVisual({ type: 'visual_placeholder', placeholderId, artifactId, revision })
            try {
              if (visualCount >= 2) throw new Error('create_visual limit exceeded (maximum 2 per answer)')
              visualCount += 1
              const artifact = createVisualArtifactFromTool({
                argsJson: call.arguments, artifactId, revision, artifacts: deps.visualArtifacts,
              })
              visualReferences.push({ artifactId, revision, altText: artifact.altText })
              deps.nodes.updateGeneration(loopInput.nodeId, {
                aiResponse: answerToProseMirror(accumulated, visualReferences),
                status: 'streaming',
              })
              emitVisual({ type: 'visual_ready', placeholderId, artifactId, revision, artifact })
              messages.push({ content: JSON.stringify({ ok: true, artifactId, revision }), role: 'tool', tool_call_id: call.id })
            } catch (error) {
              const reason = error instanceof Error ? error.message : 'create_visual failed'
              emitVisual({ type: 'visual_error', placeholderId, artifactId, revision, reason, fallback: 'text' })
              messages.push({ content: JSON.stringify({ ok: false, reason, fallback: 'Use text instead.' }), role: 'tool', tool_call_id: call.id })
            }
            continue
          }
          messages.push({
            content: root ? dispatchTool(root, call.name, call.arguments) : `错误：工具 ${call.name} 在未配置项目根目录时不可用`,
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
        loopInput.signal?.throwIfAborted()
        accumulated += chunk
        deps.nodes.updateGeneration(loopInput.nodeId, {
          aiResponse: answerToProseMirror(accumulated, visualReferences),
          status: 'streaming',
        })
        emit(chunk)
      }
      loopInput.signal?.throwIfAborted()
      return finish()
    }
  }

  return { generate }
}
