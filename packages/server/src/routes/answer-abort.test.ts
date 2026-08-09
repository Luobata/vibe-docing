import { EventEmitter } from 'node:events'
import type { NodeRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import type { DecoratedApp } from '../app'
import type { Provider } from '../provider/types'
import { registerAnswerRoutes } from './answer'

const node: NodeRow = {
  ai_response: null,
  created_at: '',
  id: 'node-1',
  is_deleted: 0,
  model_override: null,
  parent_id: null,
  sort_order: 0,
  status: 'draft',
  tree_id: 'tree-1',
  updated_at: '',
  user_input: null,
}

describe('answer route cancellation', () => {
  it('aborts the answer signal and stops sending events when request.raw closes', async () => {
    let routeHandler: ((request: unknown, reply: unknown) => Promise<unknown>) | undefined
    let observedSignal: AbortSignal | undefined
    let continuedAfterAbort = false
    const provider = {
      async complete() {
        return ''
      },
      async *stream() {
        yield ''
      },
    } satisfies Provider
    const app = {
      deps: {
        answer: {
          async generate(
            input: { signal?: AbortSignal },
            onChunk: (chunk: string) => void,
          ) {
            observedSignal = input.signal
            onChunk('first')
            await new Promise<void>((resolve) => {
              input.signal?.addEventListener('abort', () => resolve(), { once: true })
            })
            input.signal?.throwIfAborted()
            continuedAfterAbort = true
            return node
          },
        },
        nodes: { get: () => node },
        providerOverride: provider,
        settings: {},
      },
      post(_path: string, handler: typeof routeHandler) {
        routeHandler = handler
      },
    } as unknown as DecoratedApp
    registerAnswerRoutes(app)

    const requestRaw = Object.assign(new EventEmitter(), {
      aborted: false,
      socket: { destroyed: false },
    })
    const writes: string[] = []
    const replyRaw = Object.assign(new EventEmitter(), {
      destroyed: false,
      end: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
        return true
      }),
      writeHead: vi.fn(),
      writableEnded: false,
    })
    const handling = routeHandler!(
      {
        body: { userInput: '问题' },
        params: { id: node.id },
        raw: requestRaw,
      },
      { hijack: vi.fn(), raw: replyRaw },
    )

    expect(observedSignal?.aborted).toBe(false)
    requestRaw.socket.destroyed = true
    replyRaw.destroyed = true
    requestRaw.emit('close')
    await handling

    expect(observedSignal?.aborted).toBe(true)
    expect(continuedAfterAbort).toBe(false)
    expect(writes).toEqual(['data: {"type":"chunk","text":"first"}\n\n'])
    expect(writes.join('')).not.toContain('"type":"done"')
    expect(writes.join('')).not.toContain('"type":"error"')
    expect(replyRaw.end).not.toHaveBeenCalled()
  })
})
