import type { ChatMessage } from '../context/assemble'
import type { Provider } from './types'

export interface MockProviderOptions {
  chunks?: string[]
  failAfter?: number
  onMessages?: (messages: ChatMessage[]) => void
}

export function createMockProvider(options: MockProviderOptions = {}): Provider {
  const chunks = options.chunks ?? ['mock response']

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
  }
}
