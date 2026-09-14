import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from './client'

describe('materials API client', () => {
  const material = { id: 'm1', tree_id: 't1', title: 'Source', content: 'Text', content_hash: 'hash', enabled: 1 as const, created_at: 'then', updated_at: 'now' }

  it('uses the four material routes with their exact methods, bodies and snake_case responses', async () => {
    const responses = [{ materials: [material] }, { material }, { material: { ...material, enabled: 0 } }, { ok: true }]
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init: init ?? {} })
      return new Response(JSON.stringify(responses[requests.length - 1]), { status: requests.length === 2 ? 201 : 200 })
    }) as unknown as typeof fetch
    const api = createApi({ fetchImpl })
    expect(await api.listMaterials('t1')).toEqual(responses[0])
    expect(await api.createMaterial('t1', { content: 'Text', title: 'Source' })).toEqual(responses[1])
    expect(await api.updateMaterial('m1', { title: 'Edited', content: 'Updated', enabled: false })).toEqual(responses[2])
    expect(await api.deleteMaterial('m1')).toEqual(responses[3])
    expect(requests.map(({ url, init }) => [url, init.method ?? 'GET', init.body])).toEqual([
      ['/api/trees/t1/materials', 'GET', undefined],
      ['/api/trees/t1/materials', 'POST', JSON.stringify({ content: 'Text', title: 'Source' })],
      ['/api/materials/m1', 'PATCH', JSON.stringify({ title: 'Edited', content: 'Updated', enabled: false })],
      ['/api/materials/m1', 'DELETE', undefined],
    ])
    expect(requests.map(({ init }) => new Headers(init.headers).has('content-type'))).toEqual([false, true, true, false])
  })

  it('accepts an idempotent 200 create response with an omitted title and preserves the existing disabled row', async () => {
    const existing = { material: { ...material, enabled: 0 } }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(existing), { status: 200 }))
    await expect(createApi({ fetchImpl }).createMaterial('t1', { content: 'Text' })).resolves.toEqual(existing)
    expect(fetchImpl).toHaveBeenCalledWith('/api/trees/t1/materials', expect.objectContaining({ body: '{"content":"Text"}' }))
  })

  it.each([[400, 'MATERIAL_TOO_LARGE', '单条素材不能超过 10,000 字符'], [400, 'TREE_MATERIAL_LIMIT', '每棵树最多保存 20 条素材'], [409, 'MATERIAL_ALREADY_EXISTS', '当前树中已有相同内容的素材']] as const)('preserves %s %s and the readable server message', async (status, code, error) => {
    const payload = { code, error }
    const api = createApi({ fetchImpl: vi.fn(async () => new Response(JSON.stringify(payload), { status })) })
    const request = status === 409 ? api.updateMaterial('m1', { content: 'Duplicate' }) : api.createMaterial('t1', { content: 'Too much' })
    await expect(request).rejects.toBeInstanceOf(ApiError)
    await expect(request).rejects.toMatchObject({ status, payload })
  })
})

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

  it('posts correction drafts and commits to their source-scoped endpoints', async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/commit')
        ? { merge: { id: 'm1' }, node: { id: 'parent' } }
        : { mode: 'patch', pairs: [{ quote: '旧', replacement: '新' }], unmatched: { heading: '纠正附注', strategy: 'append-note' } },
    ), { headers: { 'content-type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const api = createApi({ fetchImpl })

    await api.correct('source', { direction: '改正', includeSubtree: true, mode: 'patch' })
    await api.commitCorrection('source', { direction: '改正', documentContent: '新正文' })

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/nodes/source/correct', expect.objectContaining({
      body: JSON.stringify({ direction: '改正', includeSubtree: true, mode: 'patch' }), method: 'POST',
    }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/nodes/source/correct/commit', expect.objectContaining({
      body: JSON.stringify({ direction: '改正', documentContent: '新正文' }), method: 'POST',
    }))
  })

  it('saves semantic document content with revision metadata', async () => {
    let request: RequestInit | undefined
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      request = init
      return new Response(JSON.stringify({
        content: { doc: { type: 'doc' }, nodeId: 'n1', revision: 4, schemaVersion: 1, updatedAt: 'now' },
        node: { id: 'n1' },
      }), { headers: { 'content-type': 'application/json' }, status: 200 })
    }) as unknown as typeof fetch
    const api = createApi({ fetchImpl })
    const body = {
      baseRevision: 3,
      doc: { content: [], type: 'doc' },
      editSessionId: 'session-1',
      schemaVersion: 1 as const,
    }
    const saved = await api.saveDocumentContent('n1', body, { keepalive: true })
    expect(saved.content.revision).toBe(4)
    expect(request).toMatchObject({ body: JSON.stringify(body), keepalive: true, method: 'PATCH' })
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

describe('synthesis API client', () => {
  const synthesis = { id: 's1', treeId: 't1', status: 'done', contentMd: '## 背景\n正文', sections: [], footnotes: [], nodeResults: {}, inputDigest: 'digest', error: null, createdAt: 'now', updatedAt: 'now', finishedAt: 'now' }
  const handlers = () => ({ onStarted: vi.fn(), onProgress: vi.fn(), onPhase: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onCancelled: vi.fn() })

  it('uses the server paths, methods, JSON bodies and camelCase/snake_case response shapes for all management calls', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ synthesis, syntheses: [synthesis], share: { url: '/share/token', synthesisId: 's1' }, questions: [{ id: 'q', node_id: 'n' }], question: { id: 'q', status: 'resolved' }, retrospective: { content_md: 'recap' }, cached: true, lines: [{ type: 'add', text: 'new' }], node: { id: 'n', verdict: 'adopted' }, merges: [], nodes: [], ok: true })))
    const api = createApi({ base: '/test/', fetchImpl })
    const calls: Array<[() => Promise<unknown>, string, string, unknown?]> = [
      [() => api.listSyntheses('t1'), '/trees/t1/syntheses', 'GET'],
      [() => api.getSynthesis('s1'), '/syntheses/s1', 'GET'],
      [() => api.cancelSynthesis('s1'), '/syntheses/s1/cancel', 'POST', {}],
      [() => api.diffSyntheses('s1', 's0'), '/syntheses/s1/diff/s0', 'GET'],
      [() => api.getSynthesisShare('s1'), '/syntheses/s1/share', 'GET'],
      [() => api.createSynthesisShare('s1'), '/syntheses/s1/share', 'POST', {}],
      [() => api.revokeSynthesisShare('s1'), '/syntheses/s1/share', 'DELETE'],
      [() => api.listOpenQuestions('t1'), '/trees/t1/open-questions', 'GET'],
      [() => api.extractOpenQuestions('t1'), '/trees/t1/open-questions/extract', 'POST', {}],
      [() => api.updateOpenQuestion('q', { status: 'resolved', question: 'Edited?' }), '/open-questions/q', 'PATCH', { status: 'resolved', question: 'Edited?' }],
      [() => api.getRetrospective('t1'), '/trees/t1/retrospective', 'GET'],
      [() => api.createRetrospective('t1'), '/trees/t1/retrospective', 'POST', {}],
      [() => api.listDecisions('t1'), '/trees/t1/decisions', 'GET'],
      [() => api.setNodeVerdict('n', 'adopted'), '/nodes/n/verdict', 'PATCH', { verdict: 'adopted' }],
      [() => api.setNodeVerdict('n', null), '/nodes/n/verdict', 'PATCH', { verdict: null }],
    ]
    for (const [call, path, method, body] of calls) {
      const value = await call()
      const [url, init] = fetchImpl.mock.calls.at(-1)! as unknown as [string, RequestInit]
      expect(url).toBe(`/test${path}`)
      expect(init.method ?? 'GET').toBe(method)
      expect(init.body).toBe(body === undefined ? undefined : JSON.stringify(body))
      expect(new Headers(init.headers).has('content-type')).toBe(body !== undefined)
      expect(value).toMatchObject({ synthesis: { contentMd: '## 背景\n正文', treeId: 't1' }, retrospective: { content_md: 'recap' }, questions: [{ node_id: 'n' }] })
    }
  })

  it('decodes split UTF-8/CRLF SSE frames, ignores ping and late frames, and sends an explicit empty JSON body', async () => {
    const events = [
      { type: 'started', synthesis: { ...synthesis, status: 'queued' }, total: 2 },
      { type: 'ping' },
      { type: 'progress', synthesisId: 's1', nodeId: 'n1', status: 'done', completed: 1, total: 2, failed: 0, cached: true },
      { type: 'phase', phase: 'synthesis', synthesisId: 's1' },
      { type: 'done', synthesis },
      { type: 'error', message: 'late ignored' },
    ]
    const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start(source) {
      for (let offset = 0; offset < bytes.length; offset += 7) source.enqueue(bytes.slice(offset, offset + 7))
      source.close()
    } })))
    const listener = handlers()
    const controller = new AbortController()
    await createApi({ fetchImpl }).synthesize('t1', listener, controller.signal)
    expect(fetchImpl).toHaveBeenCalledWith('/api/trees/t1/synthesize', expect.objectContaining({ method: 'POST', body: '{}', signal: controller.signal, headers: { 'content-type': 'application/json' } }))
    expect(listener.onStarted).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }), 2)
    expect(listener.onProgress).toHaveBeenCalledOnce()
    expect(listener.onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: 1, cached: true }))
    expect(listener.onPhase).toHaveBeenCalledOnce()
    expect(listener.onDone).toHaveBeenCalledWith(synthesis)
    expect(listener.onError).not.toHaveBeenCalled()
    expect(listener.onCancelled).not.toHaveBeenCalled()
  })

  it.each(['done', 'cancelled', 'error'] as const)('dispatches the %s terminal frame even without a trailing separator', async (type) => {
    const listener = handlers()
    const fetchImpl = vi.fn(async () => new Response(`data: ${JSON.stringify({ type, synthesis, message: '具体失败原因' })}`))
    await createApi({ fetchImpl }).synthesize('t1', listener)
    if (type === 'done') expect(listener.onDone).toHaveBeenCalledWith(synthesis)
    if (type === 'cancelled') expect(listener.onCancelled).toHaveBeenCalledWith(synthesis)
    if (type === 'error') expect(listener.onError).toHaveBeenCalledWith('具体失败原因', synthesis)
    expect(listener.onDone.mock.calls.length + listener.onCancelled.mock.calls.length + listener.onError.mock.calls.length).toBe(1)
  })

  it.each(['data: not-json\n\n', 'data: {"type":"ping"}\n\n'])('reports malformed or interrupted streams without reconnecting: %s', async (body) => {
    const listener = handlers()
    const fetchImpl = vi.fn(async () => new Response(body))
    await createApi({ fetchImpl }).synthesize('t1', listener)
    expect(listener.onError).toHaveBeenCalledOnce()
    expect(listener.onDone).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('preserves SYNTHESIS_RUNNING details from HTTP 409', async () => {
    const payload = { code: 'SYNTHESIS_RUNNING', synthesisId: 'existing', error: 'Already running' }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 409 }))
    await expect(createApi({ fetchImpl }).synthesize('t1', handlers())).rejects.toMatchObject({ status: 409, payload })
  })

  it('cancels a blocked reader on abort and removes the listener and timer', async () => {
    const cancel = vi.fn()
    const listener = handlers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    vi.useFakeTimers()
    try {
      const pending = createApi({ fetchImpl }).synthesize('t1', listener, controller.signal)
      await Promise.resolve()
      controller.abort()
      await pending
      expect(cancel).toHaveBeenCalledOnce()
      expect(listener.onCancelled).toHaveBeenCalledOnce()
      expect(listener.onError).not.toHaveBeenCalled()
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('closes a silent connection after the existing idle window and reports interruption', async () => {
    const listener = handlers()
    const cancel = vi.fn()
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    vi.useFakeTimers()
    try {
      const pending = createApi({ fetchImpl }).synthesize('t1', listener)
      await vi.advanceTimersByTimeAsync(50_000)
      await pending
      expect(cancel).toHaveBeenCalledOnce()
      expect(listener.onError).toHaveBeenCalledWith('连接已中断，刷新状态后可重新成文')
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
