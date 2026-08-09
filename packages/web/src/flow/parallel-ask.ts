import type { NodeRow } from '@vibe/shared'
import type { Api } from '../api/client'
import type { RouteConvergence } from '../api/types'

export async function parallelAsk(
  { api }: { api: Api },
  input: { answerNodeId: string; question: string; signal?: AbortSignal },
  handlers: {
    onCancelled?(): void
    onChunk(text: string): void
    onDone(node: NodeRow): void
    onError(message: string): void
    onRoute(convergence: RouteConvergence): void
    onRouteError(message: string): void
  },
): Promise<void> {
  const answer = api
    .streamAnswer(input.answerNodeId, input.question, {
      onCancelled: handlers.onCancelled,
      onChunk: handlers.onChunk,
      onDone: handlers.onDone,
      onError: handlers.onError,
    }, input.signal)
    .catch((error: unknown) => {
      if (input.signal?.aborted) {
        handlers.onCancelled?.()
        return
      }
      handlers.onError(error instanceof Error ? error.message : 'answer failed')
    })
  const routing = Promise.resolve()
    .then(() => api.route(input.answerNodeId))
    .then(handlers.onRoute)
    .catch((error: unknown) => {
      handlers.onRouteError(
        error instanceof Error ? error.message : 'routing failed',
      )
    })
  await Promise.all([answer, routing])
}
