import { describe, expect, it, vi } from 'vitest'
import { createApi } from './client'

describe('api client', () => {
  it('omits json content-type from requests without a body', async () => {
    const requests: RequestInit[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response('{}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }) as unknown as typeof fetch
    const api = createApi({ fetchImpl })

    await api.deleteNode('node-1')
    await api.deleteTree('tree-1')
    await api.restoreNode('node-1')
    await api.revert('node-1', 1)
    await api.route('answer-1')

    expect(requests).toHaveLength(5)
    for (const request of requests) {
      expect(request.body).toBeUndefined()
      expect(new Headers(request.headers).has('content-type')).toBe(false)
    }
  })

  it('keeps json content-type on requests with a body', async () => {
    let request: RequestInit | undefined
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      request = init
      return new Response(JSON.stringify({ rootNode: {}, tree: {} }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }) as unknown as typeof fetch

    await createApi({ fetchImpl }).createTree('tree')

    expect(request?.body).toBe(JSON.stringify({ title: 'tree' }))
    expect(new Headers(request?.headers).get('content-type')).toBe(
      'application/json',
    )
  })

  it('lists deleted trees and restores a tree with a bodyless POST', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(url.endsWith('/restore')
        ? { tree: { id: 'tree-1' } }
        : { trees: [{ id: 'tree-1' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const api = createApi({ fetchImpl })

    await expect(api.listDeletedTrees()).resolves.toMatchObject({
      trees: [{ id: 'tree-1' }],
    })
    await expect(api.restoreTree('tree-1')).resolves.toMatchObject({
      tree: { id: 'tree-1' },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/trees/deleted', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/trees/tree-1/restore',
      expect.objectContaining({ method: 'POST' }),
    )
    const restoreInit = fetchMock.mock.calls[1]?.[1]
    expect(restoreInit?.body).toBeUndefined()
    expect(new Headers(restoreInit?.headers).has('content-type')).toBe(false)
  })

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
      'data: {"type":"visual_placeholder","placeholderId":"p","artifactId":"a","revision":2}\n\n',
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
    const visualEvents: string[] = []

    await createApi({ fetchImpl }).streamAnswer('n1', 'q', {
      onChunk: (text) => chunks.push(text),
      onDone: (node) => {
        doneNodeId = node.id
      },
      onError: (message) => errors.push(message),
      onVisual: (event) => visualEvents.push(event.type),
    })

    expect(chunks).toEqual(['A', 'B'])
    expect(doneNodeId).toBe('n1')
    expect(errors).toEqual(['late warning'])
    expect(visualEvents).toEqual(['visual_placeholder'])
  })

  it('passes the abort signal to fetch and stops dispatching stream chunks', async () => {
    const encoder = new TextEncoder()
    let finishRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | null = null
    const reader = {
      cancel: vi.fn(async () => {
        finishRead?.({ done: true, value: undefined })
      }),
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode('data: {"type":"chunk","text":"A"}\n\n'),
        })
        .mockImplementation(() => new Promise((resolve) => {
          finishRead = resolve
        })),
    }
    let requestSignal: AbortSignal | null | undefined
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal
      return {
        body: { getReader: () => reader },
        ok: true,
        status: 200,
      } as unknown as Response
    }) as unknown as typeof fetch
    const controller = new AbortController()
    const chunks: string[] = []
    const onCancelled = vi.fn()
    let sawFirstChunk: (() => void) | null = null
    const firstChunk = new Promise<void>((resolve) => { sawFirstChunk = resolve })

    const streaming = createApi({ fetchImpl }).streamAnswer('n1', 'q', {
      onCancelled,
      onChunk(text) {
        chunks.push(text)
        sawFirstChunk?.()
      },
      onDone: vi.fn(),
      onError: vi.fn(),
    }, controller.signal)
    await firstChunk
    controller.abort()
    await streaming

    expect(requestSignal).toBe(controller.signal)
    expect(reader.cancel).toHaveBeenCalledOnce()
    expect(chunks).toEqual(['A'])
    expect(onCancelled).toHaveBeenCalledOnce()
  })

  it('routes AbortError to onCancelled without calling onError', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('stopped', 'AbortError'))
        }, { once: true })
      }),
    ) as unknown as typeof fetch
    const controller = new AbortController()
    const onCancelled = vi.fn()
    const onError = vi.fn()

    const streaming = createApi({ fetchImpl }).streamAnswer('n1', 'q', {
      onCancelled,
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError,
    }, controller.signal)
    controller.abort()
    await streaming

    expect(onCancelled).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })

  it('getSettings GETs /api/settings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: '/proj', provider: 'openai',
      }),
    })
    const api = createApi({ fetchImpl })
    const out = await api.getSettings()
    expect(fetchImpl).toHaveBeenCalledWith('/api/settings', expect.any(Object))
    expect(out.projectRoot).toBe('/proj')
  })

  it('updateSettings PUTs the patch as a json body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: '/x', provider: 'openai',
      }),
    })
    const api = createApi({ fetchImpl })
    const controller = new AbortController()
    await api.updateSettings({ projectRoot: '/x' }, controller.signal)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        body: JSON.stringify({ projectRoot: '/x' }),
        method: 'PUT',
        signal: controller.signal,
      }),
    )
  })

  it('createNote posts to /nodes/:id/annotation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ annotation: { id: 'a1' } }),
    })
    const api = createApi({ fetchImpl })
    const out = await api.createNote('n1', { anchorFrom: 0, anchorTo: 3, quotedText: 'x', note: '记一下' })
    expect(fetchImpl).toHaveBeenCalledWith('/api/nodes/n1/annotation', expect.objectContaining({ method: 'POST' }))
    expect(out.annotation.id).toBe('a1')
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
