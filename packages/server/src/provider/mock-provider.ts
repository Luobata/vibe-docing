import type { ChatMessage } from '../context/assemble'
import type { Provider, ToolEvent, ToolSchema } from './types'

export interface MockProviderOptions {
  chunks?: string[]
  failAfter?: number
  onMessages?: (messages: ChatMessage[]) => void
  /**
   * Scripted tool-calling rounds. Each inner array is the ordered sequence of
   * events for one `streamWithTools` invocation; successive calls consume the
   * next round. When omitted, `streamWithTools` yields the plain text chunks.
   */
  toolScript?: ToolEvent[][]
}

export function createMockProvider(options: MockProviderOptions = {}): Provider {
  const chunks = options.chunks ?? ['mock response']
  let toolRound = 0

  return {
    async complete(messages) {
      options.onMessages?.(messages)
      return chunks.join('')
    },
    async *stream(messages, streamOptions) {
      options.onMessages?.(messages)
      let emitted = 0
      for (const chunk of chunks) {
        streamOptions?.signal?.throwIfAborted()
        if (options.failAfter !== undefined && emitted >= options.failAfter) {
          throw new Error('mock stream failure')
        }
        emitted += 1
        yield chunk
      }
    },
    async *streamWithTools(
      messages: ChatMessage[],
      _tools: ToolSchema[],
      streamOptions,
    ): AsyncIterable<ToolEvent> {
      options.onMessages?.(messages)

      if (options.toolScript) {
        const round = options.toolScript[toolRound] ?? []
        toolRound += 1
        for (const event of round) {
          streamOptions?.signal?.throwIfAborted()
          yield event
        }
        return
      }

      for (const chunk of chunks) {
        streamOptions?.signal?.throwIfAborted()
        yield { type: 'text', text: chunk }
      }
    },
  }
}
