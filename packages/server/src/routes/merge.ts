import type { DecoratedApp } from '../app'
import { ProviderConfigError, resolveProvider } from '../provider/registry'
import {
  createMergeService,
  InvalidMergeError,
  MergeAlreadyExistsError,
  MergeNotFoundError,
} from '../service/merge-service'

function targetNodeIdFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined
  }
  const value = (body as Record<string, unknown>).targetNodeId
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function registerMergeRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/merge', async (request, reply) => {
    const targetNodeId = targetNodeIdFrom(request.body)
    if (!targetNodeId) {
      return reply.code(400).send({ error: 'invalid merge body' })
    }

    try {
      const provider = resolveProvider(
        { settings: app.deps.settings },
        app.deps.providerOverride,
      )
      return await createMergeService(app.deps).merge({
        provider,
        sourceNodeId: request.params.id,
        targetNodeId,
      })
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        return reply.code(503).send({ code: 'PROVIDER_CONFIG', error: error.message })
      }
      if (error instanceof MergeNotFoundError) {
        return reply.code(404).send({ error: error.message })
      }
      if (error instanceof InvalidMergeError) {
        return reply.code(400).send({ error: error.message })
      }
      if (error instanceof MergeAlreadyExistsError) {
        return reply.code(409).send({
          code: 'MERGE_ALREADY_EXISTS',
          error: error.message,
        })
      }
      throw error
    }
  })
}
