import type { ChatMessage } from '../context/assemble'

export interface ProviderStreamOptions {
  signal?: AbortSignal
}

export interface Provider {
  complete(messages: ChatMessage[]): Promise<string>
  stream(
    messages: ChatMessage[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<string>
}
