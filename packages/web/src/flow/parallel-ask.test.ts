import type { NodeRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import { parallelAsk } from './parallel-ask'

describe('parallelAsk', () => {
  it('starts routing without delaying answer chunks', async () => {
    let releaseRoute!: () => void
    const routeGate = new Promise<void>((resolve) => { releaseRoute = resolve })
    const events: string[] = []
    const answerNode = { id: 'answer-1' } as NodeRow
    const convergence = {
      candidates: [], fallback: { label: '主', refId: null, score: 1, target: 'main-continuation' },
      state: 'consistent', thresholds: { highConfidence: 0.7, leadMargin: 0.2 },
    } as const
    const api = {
      route: vi.fn(async () => { await routeGate; events.push('route'); return convergence }),
      streamAnswer: vi.fn(async (_id, _question, handlers) => {
        handlers.onChunk('A')
        events.push('chunk')
        handlers.onDone(answerNode)
      }),
    } as unknown as Parameters<typeof parallelAsk>[0]['api']

    const run = parallelAsk({ api }, { answerNodeId: 'answer-1', question: 'q' }, {
      onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(),
      onRoute: () => events.push('routed'),
    })
    await Promise.resolve()
    expect(events).toEqual(['chunk'])
    expect(api.route).toHaveBeenCalledWith('answer-1')
    releaseRoute()
    await run
    expect(events).toEqual(['chunk', 'route', 'routed'])
  })

  it('silently degrades when routing rejects', async () => {
    const onError = vi.fn()
    const api = {
      route: vi.fn(async () => { throw new Error('router unavailable') }),
      streamAnswer: vi.fn(async () => {}),
    } as unknown as Parameters<typeof parallelAsk>[0]['api']

    await parallelAsk({ api }, { answerNodeId: 'answer-1', question: 'q' }, {
      onChunk: vi.fn(), onDone: vi.fn(), onError, onRoute: vi.fn(),
    })
    expect(onError).not.toHaveBeenCalled()
  })
})
