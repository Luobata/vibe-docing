import type { ChatMessage } from '../context/assemble'
import type { Provider } from './types'

export interface CodexProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  model: string
}

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

export function createCodexProvider(config: CodexProviderConfig): Provider {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')

  async function* stream(
    messages: ChatMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncIterable<string> {
    if (!config.apiKey) throw new Error('Codex provider API key is not configured')

    const response = await fetch(`${baseUrl}/chat/completions`, {
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

  return {
    async complete(messages) {
      let response = ''
      for await (const chunk of stream(messages)) response += chunk
      return response
    },
    stream,
  }
}
