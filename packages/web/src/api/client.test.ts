import { describe, expect, it, vi } from 'vitest'
import { createApi } from './client'

describe('api client', () => {
  it('wraps tree creation and node-scoped routing', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const payload = url.endsWith('/route')
        ? { candidates: [], fallback: {}, state: 'failed', thresholds: {} }
        : { rootNode: { id: 'n1' }, tree: { id: 't1', title: 'x' } }
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }) as unknown as typeof fetch
    const api = createApi({ fetchImpl })

    const created = await api.createTree('x')
    await api.route('answer-1')

    expect(created.tree.id).toBe('t1')
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/trees',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/nodes/answer-1/route',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('parses chunked SSE chunk, done, and error events', async () => {
    const encoder = new TextEncoder()
    const pieces = [
      'data: {"type":"chunk","text":"A"}\n\nda',
      'ta: {"type":"chunk","text":"B"}\n\ndata: {"type":"done","node":{"id":"n1"}}\n\n',
      'data: {"type":"error","message":"late warning"}\n\n',
    ]
    const body = new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece))
        controller.close()
      },
    })
    const fetchImpl = vi.fn(async () =>
      new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      }),
    ) as unknown as typeof fetch
    const chunks: string[] = []
    const errors: string[] = []
    let doneNodeId: string | null = null

    await createApi({ fetchImpl }).streamAnswer('n1', 'q', {
      onChunk: (text) => chunks.push(text),
      onDone: (node) => {
        doneNodeId = node.id
      },
      onError: (message) => errors.push(message),
    })

    expect(chunks).toEqual(['A', 'B'])
    expect(doneNodeId).toBe('n1')
    expect(errors).toEqual(['late warning'])
  })

  it('rejects non-success responses with status context', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'missing' }), { status: 404 }),
    ) as unknown as typeof fetch

    await expect(createApi({ fetchImpl }).getNode('missing')).rejects.toThrow(
      'HTTP 404',
    )
  })

  it('preserves a non-json error response', async () => {
    const fetchImpl = vi.fn(async () => new Response('offline', { status: 503 })) as
      unknown as typeof fetch

    await expect(createApi({ fetchImpl }).getNode('n1')).rejects.toMatchObject({
      payload: 'offline',
      status: 503,
    })
  })
})
