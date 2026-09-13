import type { ChatMessage } from '../context/assemble'
import type { Provider, ProviderStreamOptions, ToolEvent, ToolSchema } from './types'

export interface AnthropicProviderConfig {
  apiKey: string | null
  apiKeySource?: string
  baseUrl: string | null
  model: string
  maxTokens?: number
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export function buildAnthropicRequest(
  config: AnthropicProviderConfig,
  messages: ChatMessage[],
  options: ProviderStreamOptions & { stream?: boolean; maxTokens?: number; tools?: ToolSchema[] } = {},
): { url: string; init: RequestInit } {
  const system: string[] = []
  const translated: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = []
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
    } else if (message.role === 'tool') {
      const block: ContentBlock = { type: 'tool_result', tool_use_id: message.tool_call_id!, content: message.content }
      const previous = translated.at(-1)
      if (previous?.role === 'user' && Array.isArray(previous.content)) previous.content.push(block)
      else translated.push({ role: 'user', content: [block] })
    } else if (message.role === 'assistant' && message.tool_calls?.length) {
      const content: ContentBlock[] = message.content ? [{ type: 'text', text: message.content }] : []
      for (const call of message.tool_calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) })
      }
      translated.push({ role: 'assistant', content })
    } else {
      translated.push({ role: message.role, content: message.content })
    }
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (options.stream) headers.accept = 'text/event-stream'
  if (config.apiKey) {
    if (config.apiKeySource === 'ANTHROPIC_AUTH_TOKEN') headers.authorization = `Bearer ${config.apiKey}`
    else headers['x-api-key'] = config.apiKey
  }
  return {
    url: `${(config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
    init: {
      method: 'POST', headers, signal: options.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: options.maxTokens ?? config.maxTokens ?? 32768,
        messages: translated,
        ...(system.length ? { system: system.join('\n\n') } : {}),
        ...(options.stream ? { stream: true } : {}),
        ...(options.tools?.length ? { tools: options.tools.map(({ function: tool }) => ({
          name: tool.name, description: tool.description, input_schema: tool.parameters,
        })) } : {}),
      }),
    },
  }
}

interface StreamEvent {
  type: string
  index?: number
  content_block?: { type: string; id: string; name: string; input: unknown }
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
}

async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  let data: string[] = []
  function parseEvent(): StreamEvent | undefined {
    if (!data.length) return undefined
    try {
      const event = JSON.parse(data.join('\n')) as StreamEvent
      return { ...event, type: event.type ?? eventType }
    } catch {
      throw new Error('Anthropic provider returned an invalid stream event')
    } finally {
      data = []
      eventType = ''
    }
  }
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (done && buffer) lines.push(buffer)
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '')
        if (line === '') {
          const event = parseEvent()
          if (event) yield event
        } else if (line.startsWith('event:')) eventType = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (done) {
        const event = parseEvent()
        if (event) yield event
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createAnthropicProvider(config: AnthropicProviderConfig, fetchImpl: typeof fetch = fetch): Provider {
  async function* streamWithTools(
    messages: ChatMessage[], tools: ToolSchema[], options?: ProviderStreamOptions,
  ): AsyncIterable<ToolEvent> {
    options?.signal?.throwIfAborted()
    if (!config.apiKey) throw new Error('Anthropic provider API key is not configured')
    const request = buildAnthropicRequest(config, messages, { ...options, stream: true, tools })
    const response = await fetchImpl(request.url, request.init)
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {})
      throw new Error(`Anthropic provider request failed with status ${response.status}`)
    }
    const calls = new Map<number, { id: string; name: string; input: unknown; arguments: string }>()
    let stopped = false
    for await (const event of readEvents(response.body, options?.signal)) {
      options?.signal?.throwIfAborted()
      if (event.type === 'error') throw new Error('Anthropic provider returned a stream error')
      if (event.type === 'message_stop') {
        stopped = true
        break
      }
      if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') {
        throw new Error('Anthropic provider response reached max_tokens; increase VIBE_LLM_MAX_TOKENS')
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use' && event.index !== undefined) {
        const block = event.content_block
        calls.set(event.index, { id: block.id, name: block.name, input: block.input, arguments: '' })
      }
      if (event.type !== 'content_block_delta') continue
      if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
        yield { type: 'text', text: event.delta.text }
      } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
        const call = calls.get(event.index)
        if (call && typeof event.delta.partial_json === 'string') call.arguments += event.delta.partial_json
      }
    }
    if (!stopped) throw new Error('Anthropic provider stream ended before message_stop')
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      options?.signal?.throwIfAborted()
      yield { type: 'tool_call', id: call.id, name: call.name, arguments: call.arguments || JSON.stringify(call.input ?? {}) }
    }
  }

  async function* stream(messages: ChatMessage[], options?: ProviderStreamOptions): AsyncIterable<string> {
    for await (const event of streamWithTools(messages, [], options)) {
      if (event.type === 'text') yield event.text
    }
  }

  return {
    async complete(messages) {
      let result = ''
      for await (const text of stream(messages)) result += text
      return result
    },
    stream, streamWithTools,
  }
}
