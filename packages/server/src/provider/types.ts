import type { ChatMessage } from '../context/assemble'

export interface ProviderStreamOptions {
  signal?: AbortSignal
}

export type ToolEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }

export interface ToolSchema {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface Provider {
  complete(messages: ChatMessage[]): Promise<string>
  stream(
    messages: ChatMessage[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<string>
  streamWithTools?(
    messages: ChatMessage[],
    tools: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<ToolEvent>
}
