import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from './client'

afterEach(() => vi.useRealTimers())

function setup() {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller }, cancel })
  const fetchImpl = vi.fn(async () => new Response(body)) as unknown as typeof fetch
  const api = createApi({ fetchImpl })
  const handlers = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onPing: vi.fn(), onCancelled: vi.fn() }
  const send = (event: unknown) => source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return { api, source, cancel, fetchImpl, handlers, send }
}

describe('discussion client', () => {
  it('lists messages and posts promotion with the requested revision and source ids', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [], node: { id: 'child' }, content: { revision: 3 } }))) as unknown as typeof fetch
    const api = createApi({ fetchImpl })
    expect((await api.listDiscussion('n1')).messages).toEqual([])
    const body = { mode: 'section' as const, messageIds: ['m1'], baseRevision: 2 }
    expect((await api.promoteDiscussion('n1', body)).content.revision).toBe(3)
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/nodes/n1/discussion', expect.anything())
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/nodes/n1/discussion/promote', expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }))
  })

  it('preserves HTTP error payloads including promotion conflicts', async () => {
    const payload = { currentRevision: 4, error: 'content conflict' }
    const api = createApi({ fetchImpl: async () => new Response(JSON.stringify(payload), { status: 409 }) })
    await expect(api.promoteDiscussion('n1', { mode: 'section', messageIds: ['m1'], baseRevision: 3 })).rejects.toMatchObject({ status: 409, payload })
    await expect(api.sendDiscussion('n1', 'q', setup().handlers)).rejects.toBeInstanceOf(ApiError)
  })

  it('decodes fragmented UTF-8, step metadata, and done messages without an answer node', async () => {
    const { api, source, fetchImpl, handlers } = setup()
    const pending = api.runDiscussionMove('n1', 'perspectives', handlers)
    const bytes = new TextEncoder().encode('data: {"type":"chunk","text":"观点","step":2,"persona":"保守派"}\r\n\r\ndata: {"type":"done","messages":[{"id":"m1"}]}')
    for (const byte of bytes) source.enqueue(new Uint8Array([byte]))
    source.close()
    await pending
    expect(fetchImpl).toHaveBeenCalledWith('/api/nodes/n1/discussion/moves', expect.objectContaining({ body: JSON.stringify({ move: 'perspectives' }) }))
    expect(handlers.onChunk).toHaveBeenCalledWith('观点', { step: 2, persona: '保守派' })
    expect(handlers.onDone).toHaveBeenCalledWith([{ id: 'm1' }])
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('keeps a silent discussion alive for 60 seconds using pings', async () => {
    vi.useFakeTimers()
    const { api, source, cancel, handlers, send } = setup()
    const pending = api.sendDiscussion('n1', 'question', handlers)
    await Promise.resolve()
    for (let index = 0; index < 6; index += 1) {
      await vi.advanceTimersByTimeAsync(10_000)
      send({ type: 'ping' })
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(cancel).not.toHaveBeenCalled()
    expect(handlers.onPing).toHaveBeenCalledTimes(6)
    send({ type: 'done', messages: [] })
    source.close()
    await pending
    expect(handlers.onDone).toHaveBeenCalledWith([])
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an idle stream and reports interruption once, with no timers left', async () => {
    vi.useFakeTimers()
    const { api, cancel, handlers } = setup()
    const pending = api.sendDiscussion('n1', 'q', handlers)
    await vi.advanceTimersByTimeAsync(50_000)
    await pending
    expect(cancel).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('连接已中断，请重试')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a pending read without reporting an error or later chunks', async () => {
    vi.useFakeTimers()
    const { api, cancel, handlers, send } = setup()
    const controller = new AbortController()
    const pending = api.sendDiscussion('n1', 'q', handlers, controller.signal)
    send({ type: 'chunk', text: 'partial' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await pending
    expect(handlers.onChunk).toHaveBeenCalledOnce()
    expect(handlers.onCancelled).toHaveBeenCalledOnce()
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a failed step with completed messages and ignores events after the error', async () => {
    const { api, handlers, send } = setup()
    const pending = api.runDiscussionMove('n1', 'perspectives', handlers)
    send({ type: 'chunk', text: 'partial', step: 2, persona: '保守派' })
    send({ type: 'error', message: 'failed', step: 2, persona: '保守派', messages: [{ id: 'first' }] })
    send({ type: 'chunk', text: 'late' })
    await pending
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('failed', { step: 2, persona: '保守派', messages: [{ id: 'first' }] })
    expect(handlers.onChunk).toHaveBeenCalledOnce()
    expect(handlers.onDone).not.toHaveBeenCalled()
  })

  it('keeps partial text on premature EOF', async () => {
    const { api, handlers, send, source } = setup()
    const pending = api.sendDiscussion('n1', 'q', handlers)
    send({ type: 'chunk', text: 'partial' })
    source.close()
    await pending
    expect(handlers.onChunk).toHaveBeenCalledWith('partial', { step: undefined, persona: undefined })
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('连接已中断，请重试')
  })
})
