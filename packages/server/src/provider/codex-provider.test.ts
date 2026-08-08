import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../context/assemble'
import { createCodexProvider } from './codex-provider'
import type { ToolEvent, ToolSchema } from './types'

const messages: ChatMessage[] = [{ content: 'hello', role: 'user' }]
const tools: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
]

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

describe('createCodexProvider streamWithTools', () => {
  it('emits text and one aggregated tool_call from fragmented SSE', async () => {
    const chunks = [
      `data: ${JSON.stringify({
        choices: [{ delta: { content: 'thinking...' } }],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"pa' },
                },
              ],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      })}\n\n`,
      'data: [DONE]\n\n',
    ]

    const fetchImpl = (async () => sseResponse(chunks)) as typeof fetch
    const provider = createCodexProvider(
      { apiKey: 'test-key', baseUrl: null, model: 'gpt-test' },
      fetchImpl,
    )

    expect(provider.streamWithTools).toBeTypeOf('function')

    const events: ToolEvent[] = []
    for await (const event of provider.streamWithTools!(messages, tools)) {
      events.push(event)
    }

    expect(events).toContainEqual({ type: 'text', text: 'thinking...' })

    const toolCalls = events.filter((event) => event.type === 'tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"x"}',
    })
  })
})
