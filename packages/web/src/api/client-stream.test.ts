import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from './client'

function setup() {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) { source = controller },
    cancel,
  })
  const reader = body.getReader()
  const read = vi.spyOn(reader, 'read')
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true, status: 200, body: { getReader: () => reader },
  }) as unknown as Response)
  const handlers = { onCancelled: vi.fn(), onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onVisual: vi.fn() }
  const send = (text: string) => source.enqueue(new TextEncoder().encode(text))
  const start = async (signal?: AbortSignal) => {
    const pending = createApi({ fetchImpl }).streamAnswer('n1', 'question', handlers, signal)
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    return { pending }
  }
  return { source, cancel, fetchImpl, handlers, send, start }
}

describe('answer stream liveness', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('cancels a stalled read after 45 seconds of inactivity and reports a disconnected stream once', async () => {
    const { cancel, handlers, start } = setup()
    const { pending } = await start()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(cancel).not.toHaveBeenCalled()
    expect(handlers.onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(cancel).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('连接已中断，请重试')
    expect(handlers.onDone).not.toHaveBeenCalled()
    expect(handlers.onCancelled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores ping frames while refreshing activity until a normal done frame arrives', async () => {
    const { source, cancel, handlers, send, start } = setup()
    const { pending } = await start()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
      send('data: {"type":"ping"}\n\n')
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(cancel).not.toHaveBeenCalled()
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
    send('data: {"type":"chunk","text":"answer"}\n\ndata: {"type":"done","node":{"id":"n1"}}\n\n')
    source.close()
    await pending
    expect(handlers.onChunk).toHaveBeenCalledOnce()
    expect(handlers.onChunk).toHaveBeenCalledWith('answer')
    expect(handlers.onDone).toHaveBeenCalledOnce()
    expect(handlers.onDone).toHaveBeenCalledWith({ id: 'n1' })
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts partial frame bytes as activity and expires only after that activity stops', async () => {
    const { cancel, handlers, send, start } = setup()
    const { pending } = await start()
    await vi.advanceTimersByTimeAsync(40_000)
    send('data: {"type":')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(cancel).not.toHaveBeenCalled()
    send('"ping"}\n\n')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(cancel).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('连接已中断，请重试')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports EOF without done or error while retaining emitted chunks', async () => {
    const { source, handlers, send, start } = setup()
    const { pending } = await start()
    send('data: {"type":"chunk","text":"partial"}\n\n')
    source.close()
    await pending
    expect(handlers.onChunk).toHaveBeenCalledOnce()
    expect(handlers.onChunk).toHaveBeenCalledWith('partial')
    expect(handlers.onError).toHaveBeenCalledOnce()
    expect(handlers.onError).toHaveBeenCalledWith('连接已中断，请重试')
    expect(handlers.onDone).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['done', 'data: {"type":"done","node":{"id":"n1"}}'],
    ['error', 'data: {"type":"error","message":"upstream failed"}'],
  ])('does not add a disconnected error after a final %s frame without a trailing separator', async (type, frame) => {
    const { source, handlers, send, start } = setup()
    const { pending } = await start()
    send(frame)
    source.close()
    await pending
    if (type === 'done') {
      expect(handlers.onDone).toHaveBeenCalledOnce()
      expect(handlers.onDone).toHaveBeenCalledWith({ id: 'n1' })
      expect(handlers.onError).not.toHaveBeenCalled()
    } else {
      expect(handlers.onError).toHaveBeenCalledOnce()
      expect(handlers.onError).toHaveBeenCalledWith('upstream failed')
      expect(handlers.onDone).not.toHaveBeenCalled()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves cancellation without reporting a connection error and clears the watchdog', async () => {
    const { cancel, fetchImpl, handlers, start } = setup()
    const controller = new AbortController()
    const { pending } = await start(controller.signal)
    await vi.advanceTimersByTimeAsync(40_000)
    controller.abort()
    await pending
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(controller.signal)
    expect(cancel).toHaveBeenCalledOnce()
    expect(handlers.onCancelled).toHaveBeenCalledOnce()
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(50_000)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('preserves rejected reads and HTTP errors while cleaning timers', async () => {
    const { source, handlers, start } = setup()
    const { pending } = await start()
    const failure = new Error('connection reset')
    source.error(failure)
    await expect(pending).rejects.toBe(failure)
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const api = createApi({ fetchImpl: async () => new Response('unavailable', { status: 503 }) })
    await expect(api.streamAnswer('n1', 'q', handlers)).rejects.toBeInstanceOf(ApiError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
