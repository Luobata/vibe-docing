import type { NodeRow } from '@vibe/shared'
import type { Api } from '../api/client'
import type { RouteConvergence } from '../api/types'

export async function parallelAsk(
  { api }: { api: Api },
  input: { answerNodeId: string; question: string },
  handlers: {
    onChunk(text: string): void
    onDone(node: NodeRow): void
    onError(message: string): void
    onRoute(convergence: RouteConvergence): void
  },
): Promise<void> {
  const answer = api
    .streamAnswer(input.answerNodeId, input.question, {
      onChunk: handlers.onChunk,
      onDone: handlers.onDone,
      onError: handlers.onError,
    })
    .catch((error: unknown) => {
      handlers.onError(error instanceof Error ? error.message : 'answer failed')
    })
  const routing = api.route(input.answerNodeId).then(handlers.onRoute).catch(() => {
    // Routing is advisory. Its failure must never disturb the streamed answer.
  })
  await Promise.all([answer, routing])
}
