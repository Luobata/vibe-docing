import type { DecoratedApp } from '../app'
import { resolveProvider } from '../provider/registry'

function userInputFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).userInput
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function registerAnswerRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/answer', async (request, reply) => {
    const userInput = userInputFrom(request.body)
    if (!userInput) return reply.code(400).send({ error: 'invalid userInput' })

    const existing = app.deps.nodes.get(request.params.id)
    if (!existing || existing.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    })
    const send = (event: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      const provider = resolveProvider(
        { settings: app.deps.settings },
        app.deps.providerOverride,
      )
      const node = await app.deps.answer.generate(
        { nodeId: existing.id, provider, userInput },
        (text) => send({ type: 'chunk', text }),
      )
      send({ type: 'done', node })
    } catch (error) {
      send({
        message: error instanceof Error ? error.message : 'answer failed',
        node: app.deps.nodes.get(existing.id),
        type: 'error',
      })
    } finally {
      reply.raw.end()
    }
  })
}
