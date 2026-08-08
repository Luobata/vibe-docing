import type { ChatMessage } from '../context/assemble'
import type {
  Provider,
  ProviderStreamOptions,
  ToolEvent,
  ToolSchema,
} from './types'

export interface CodexProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  model: string
}

type FetchImpl = typeof fetch

function readDelta(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return undefined
  const data = trimmed.slice('data:'.length).trim()
  if (!data || data === '[DONE]') return undefined

  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>
    }
    const content = payload.choices?.[0]?.delta?.content
    return typeof content === 'string' ? content : undefined
  } catch {
    return undefined
  }
}

interface ToolCallAccumulator {
  id: string
  name: string
  argsBuffer: string
}

interface ToolChoice {
  delta?: {
    content?: unknown
    tool_calls?: Array<{
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }>
  }
  finish_reason?: string | null
}

export function createCodexProvider(
  config: CodexProviderConfig,
  fetchImpl: FetchImpl = fetch,
): Provider {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')

  async function* stream(
    messages: ChatMessage[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<string> {
    if (!config.apiKey) throw new Error('Codex provider API key is not configured')

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({ messages, model: config.model, stream: true }),
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: options?.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Codex provider request failed with status ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const delta = readDelta(line)
        if (delta !== undefined) yield delta
        if (line.trim() === 'data: [DONE]') return
      }
      if (done) break
    }
    const finalDelta = readDelta(buffer)
    if (finalDelta !== undefined) yield finalDelta
  }

  async function* streamWithTools(
    messages: ChatMessage[],
    tools: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<ToolEvent> {
    if (!config.apiKey) throw new Error('Codex provider API key is not configured')

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages,
        model: config.model,
        stream: true,
        tools,
        tool_choice: 'auto',
      }),
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: options?.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Codex provider request failed with status ${response.status}`)
    }

    const accumulators = new Map<number, ToolCallAccumulator>()
    const order: number[] = []

    // Parse one SSE line. Returns text to emit (if any) and whether the stream
    // has signalled completion via [DONE]. tool_call fragments are accumulated
    // by index into `accumulators` and emitted after the stream ends.
    function parseLine(line: string): { text?: string; done: boolean } {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return { done: false }
      const data = trimmed.slice('data:'.length).trim()
      if (!data) return { done: false }
      if (data === '[DONE]') return { done: true }

      let payload: { choices?: ToolChoice[] }
      try {
        payload = JSON.parse(data) as { choices?: ToolChoice[] }
      } catch {
        return { done: false }
      }

      const choice = payload.choices?.[0]
      if (!choice) return { done: false }

      const toolCalls = choice.delta?.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          const index = call.index ?? 0
          let acc = accumulators.get(index)
          if (!acc) {
            acc = { id: '', name: '', argsBuffer: '' }
            accumulators.set(index, acc)
            order.push(index)
          }
          if (typeof call.id === 'string') acc.id = call.id
          if (typeof call.function?.name === 'string') acc.name = call.function.name
          if (typeof call.function?.arguments === 'string') {
            acc.argsBuffer += call.function.arguments
          }
        }
      }

      const content = choice.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        return { text: content, done: false }
      }
      return { done: false }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamDone = false
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseLine(line)
        if (parsed.text !== undefined) yield { type: 'text', text: parsed.text }
        if (parsed.done) {
          streamDone = true
          break
        }
      }
      if (streamDone || done) break
    }
    if (!streamDone) {
      const parsed = parseLine(buffer)
      if (parsed.text !== undefined) yield { type: 'text', text: parsed.text }
    }

    for (const index of [...order].sort((a, b) => a - b)) {
      const acc = accumulators.get(index)
      if (!acc) continue
      yield {
        type: 'tool_call',
        id: acc.id,
        name: acc.name,
        arguments: acc.argsBuffer,
      }
    }
  }

  return {
    async complete(messages) {
      let response = ''
      for await (const chunk of stream(messages)) response += chunk
      return response
    },
    stream,
    streamWithTools,
  }
}
