import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../context/assemble'
import { buildAnthropicRequest, createAnthropicProvider } from './anthropic-provider'
import type { ToolSchema } from './types'

const config = { apiKey: 'fixture-key', baseUrl: null, model: 'fixture-model' }
const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
const tools: ToolSchema[] = [{ type: 'function', function: {
  name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } },
} }]
const toolCall = (id: string, path: string) => ({ id, type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path }) } })
const event = (type: string, extra: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
const textDelta = (text: string) => event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
const toolStart = (index: number, id = `call_${index}`) => event('content_block_start', { index, content_block: { type: 'tool_use', id, name: 'read_file', input: {} } })
const inputDelta = (index: number, partial_json: string) => event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json } })
const stop = event('message_stop')
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of stream) result.push(item)
  return result
}
function fromSse(sse: string) {
  // Fragment every UTF-8 byte, including inside JSON and Chinese characters.
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of new TextEncoder().encode(sse)) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })
  return createAnthropicProvider(config, async () => new Response(body))
}
function requestBody(input: ChatMessage[]) {
  return JSON.parse(buildAnthropicRequest(config, input).init.body as string)
}

describe('Anthropic request translation', () => {
  it('preserves ordinary user and assistant text', () => {
    const input: ChatMessage[] = [...messages, { role: 'assistant', content: 'hi' }]
    expect(requestBody(input).messages).toEqual(input)
  })

  it('#3 preserves assistant text plus tool_calls in a mixed round', () => {
    expect(requestBody([{ role: 'assistant', content: 'I will read both.', tool_calls: [toolCall('a', 'one'), toolCall('b', 'two')] }]).messages).toEqual([
      { role: 'assistant', content: [
        { type: 'text', text: 'I will read both.' },
        { type: 'tool_use', id: 'a', name: 'read_file', input: { path: 'one' } },
        { type: 'tool_use', id: 'b', name: 'read_file', input: { path: 'two' } },
      ] },
    ])
    expect(requestBody([{ role: 'assistant', content: '', tool_calls: [toolCall('a', 'one')] }]).messages[0].content).toHaveLength(1)
  })

  it('#5 aggregates initial and mid-conversation system messages at the top level', () => {
    expect(requestBody([
      { role: 'system', content: 'Initial instruction' }, ...messages,
      { role: 'assistant', content: 'intermediate' },
      { role: 'system', content: '工具调用轮数已达上限，请基于已有信息作答。' },
    ])).toMatchObject({
      system: 'Initial instruction\n\n工具调用轮数已达上限，请基于已有信息作答。',
      messages: [...messages, { role: 'assistant', content: 'intermediate' }],
    })
  })

  it('groups consecutive tool results into one user message and preserves result strings', () => {
    expect(requestBody([
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 'b', content: '错误：文件不存在' },
      ...messages,
    ]).messages).toEqual([
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: '{"ok":true}' },
        { type: 'tool_result', tool_use_id: 'b', content: '错误：文件不存在' },
      ] }, ...messages,
    ])
  })

  it('translates schemas and sends the required max_tokens default or override', () => {
    const request = buildAnthropicRequest(config, messages, { tools, stream: true })
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(JSON.parse(request.init.body as string)).toEqual({
      model: config.model, max_tokens: 32768, stream: true, messages,
      tools: [{ name: 'read_file', description: 'Read a file', input_schema: tools[0].function.parameters }],
    })
    expect(JSON.parse(buildAnthropicRequest({ ...config, maxTokens: 4096 }, messages).init.body as string).max_tokens).toBe(4096)
    expect(JSON.parse(buildAnthropicRequest({ ...config, maxTokens: 4096 }, messages, { maxTokens: 1 }).init.body as string).max_tokens).toBe(1)
  })

  it.each(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'VIBE_LLM_API_KEY', 'settings', undefined])('uses one authentication header for source %s', (apiKeySource) => {
    const { init } = buildAnthropicRequest({ ...config, apiKeySource }, messages)
    const headers = new Headers(init.headers)
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('authorization')).toBe(apiKeySource === 'ANTHROPIC_AUTH_TOKEN' ? 'Bearer fixture-key' : null)
    expect(headers.get('x-api-key')).toBe(apiKeySource === 'ANTHROPIC_AUTH_TOKEN' ? null : 'fixture-key')
  })
})

describe('Anthropic SSE fixtures', () => {
  it('streams plain text across byte boundaries and stops at message_stop without DONE', async () => {
    const sse = event('message_start') + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + textDelta('你好') + textDelta(' world') + event('content_block_stop', { index: 0 })
      + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + stop + textDelta('ignored')
    expect(await collect(fromSse(sse).stream(messages))).toEqual(['你好', ' world'])
    expect(await fromSse(sse).complete(messages)).toBe('你好 world')
  })

  it('ignores thinking and signature deltas without including them in complete', async () => {
    const sse = event('content_block_start', { index: 0, content_block: { type: 'thinking' } })
      + event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'private reasoning' } })
      + event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'signature' } }) + textDelta('answer') + stop
    expect(await fromSse(sse).complete(messages)).toBe('answer')
  })

  it('accumulates one tool_use from partial_json fragments', async () => {
    const provider = fromSse(toolStart(0) + inputDelta(0, '{"pa') + inputDelta(0, 'th":"x"}') + event('content_block_stop', { index: 0 }) + stop)
    expect(await collect(provider.streamWithTools!(messages, tools))).toEqual([
      { type: 'tool_call', id: 'call_0', name: 'read_file', arguments: '{"path":"x"}' },
    ])
  })

  it('emits text before the batched tool call in a mixed response', async () => {
    const provider = fromSse(textDelta('I will inspect.') + toolStart(1) + inputDelta(1, '{"path":"x"}') + stop)
    expect(await collect(provider.streamWithTools!(messages, tools))).toEqual([
      { type: 'text', text: 'I will inspect.' },
      { type: 'tool_call', id: 'call_1', name: 'read_file', arguments: '{"path":"x"}' },
    ])
  })

  it('accumulates interleaved parallel tools separately and emits by ascending index', async () => {
    const provider = fromSse(toolStart(3) + toolStart(1) + inputDelta(3, '{"path":') + inputDelta(1, '{"path":"a"}') + inputDelta(3, '"b"}') + stop)
    expect(await collect(provider.streamWithTools!(messages, tools))).toEqual([
      { type: 'tool_call', id: 'call_1', name: 'read_file', arguments: '{"path":"a"}' },
      { type: 'tool_call', id: 'call_3', name: 'read_file', arguments: '{"path":"b"}' },
    ])
  })

  it('ignores interleaved ping, comments and unknown events with CRLF frames', async () => {
    const sse = ': keep-alive\n\n' + event('ping') + textDelta('a') + event('future_event') + event('ping') + textDelta('b') + stop
    expect(await fromSse(sse.replaceAll('\n', '\r\n')).complete(messages)).toBe('ab')
  })

  it('forwards AbortSignal and rejects an aborted response read with AbortError', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream({ start(stream) {
      stream.enqueue(new TextEncoder().encode(textDelta('first')))
      init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason), { once: true })
    } })))
    const provider = createAnthropicProvider(config, fetchImpl)
    const iterator = provider.stream(messages, { signal: controller.signal })[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: 'first' })
    const next = iterator.next()
    controller.abort()
    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(controller.signal)
    const toolsController = new AbortController()
    const calls = fromSse(toolStart(0) + toolStart(1) + stop).streamWithTools!(messages, tools, { signal: toolsController.signal })[Symbol.asyncIterator]()
    expect((await calls.next()).value).toMatchObject({ type: 'tool_call', id: 'call_0' })
    toolsController.abort()
    await expect(calls.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('throws for an error event without exposing upstream messages', async () => {
    const provider = fromSse(event('error', { error: { type: 'overloaded_error', message: 'fixture-secret' } }))
    await expect(provider.complete(messages)).rejects.toThrow('Anthropic provider returned a stream error')
  })

  it('reports max_tokens truncation instead of accepting a partial completion', async () => {
    const provider = fromSse(textDelta('partial') + event('message_delta', { delta: { stop_reason: 'max_tokens' } }) + stop)
    await expect(provider.complete(messages)).rejects.toThrow('reached max_tokens')
  })

  it('rejects a disconnected stream before returning pending tool calls', async () => {
    const provider = fromSse(toolStart(0) + inputDelta(0, '{"path":'))
    await expect(collect(provider.streamWithTools!(messages, tools))).rejects.toThrow('before message_stop')
  })

  it('ends at message_stop and cancels an otherwise open connection', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(textDelta('done') + stop))
    }, cancel })
    expect(await createAnthropicProvider(config, async () => new Response(body)).complete(messages)).toBe('done')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects missing credentials and HTTP errors without exposing response bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response('fixture-secret', { status: 401 }))
    await expect(createAnthropicProvider({ ...config, apiKey: null }, fetchImpl).complete(messages)).rejects.toThrow('API key is not configured')
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(createAnthropicProvider(config, fetchImpl).complete(messages)).rejects.toThrow('failed with status 401')
  })
})
