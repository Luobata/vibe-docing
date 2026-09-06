import type { CorrectionMode } from '@vibe/shared'
import type { DecoratedApp } from '../app'
import type { AppReply, RouteHandler } from '../http/app-instance'
import { ProviderConfigError, resolveProvider } from '../provider/registry'
import {
  CorrectionNotFoundError,
  createCorrectService,
  InvalidCorrectionError,
} from '../service/correct-service'

const MAX_DIRECTION_LENGTH = 2_000
const MAX_DOCUMENT_CONTENT_LENGTH = 2_000_000
// Fastify limits bytes, while JSON escaping can use six bytes per string character.
const MAX_COMMIT_BODY_BYTES = MAX_DOCUMENT_CONTENT_LENGTH * 6 + 100_000

function objectBody(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined
}

function errorResponse(error: unknown, reply: AppReply) {
  if (error instanceof ProviderConfigError) {
    return reply.code(503).send({ code: 'PROVIDER_CONFIG', error: error.message })
  }
  if (error instanceof CorrectionNotFoundError) {
    return reply.code(404).send({ error: error.message })
  }
  if (error instanceof InvalidCorrectionError) {
    return reply.code(400).send({ error: error.message })
  }
  throw error
}

export function registerCorrectRoutes(app: DecoratedApp): void {
  const service = createCorrectService(app.deps)

  app.post('/api/nodes/:id/correct', async (request, reply) => {
    const body = objectBody(request.body)
    const direction = typeof body?.direction === 'string' ? body.direction : ''
    const mode = body?.mode
    const includeSubtree = body?.includeSubtree ?? true
    if (
      !direction.trim()
      || (mode !== 'patch' && mode !== 'append' && mode !== 'rewrite')
      || typeof includeSubtree !== 'boolean'
    ) {
      return reply.code(400).send({ error: 'invalid correction body' })
    }
    if (direction.length > MAX_DIRECTION_LENGTH) {
      return reply.code(400).send({ error: 'direction too long' })
    }
    try {
      const provider = resolveProvider({ settings: app.deps.settings }, app.deps.providerOverride)
      return await service.draft({
        direction,
        includeSubtree,
        mode: mode as CorrectionMode,
        provider,
        sourceNodeId: request.params.id,
      })
    } catch (error) {
      return errorResponse(error, reply)
    }
  })

  const commitPath = '/api/nodes/:id/correct/commit'
  const commitHandler: RouteHandler = async (request, reply) => {
    const body = objectBody(request.body)
    const direction = typeof body?.direction === 'string' ? body.direction : ''
    const documentContent = typeof body?.documentContent === 'string' ? body.documentContent : undefined
    if (!direction.trim() || documentContent === undefined) {
      return reply.code(400).send({ error: 'invalid correction commit body' })
    }
    if (documentContent.length > MAX_DOCUMENT_CONTENT_LENGTH) {
      return reply.code(400).send({ error: 'document content too long' })
    }
    if (!documentContent.trim()) {
      return reply.code(400).send({ error: 'invalid correction commit body' })
    }
    try {
      return service.commit({
        direction,
        documentContent,
        sourceNodeId: request.params.id,
      })
    } catch (error) {
      return errorResponse(error, reply)
    }
  }

  if (typeof app.route === 'function') {
    const route = app.route as (options: {
      bodyLimit: number
      handler: RouteHandler
      method: 'POST'
      url: string
    }) => unknown
    route.call(app, {
      bodyLimit: MAX_COMMIT_BODY_BYTES,
      handler: commitHandler,
      method: 'POST',
      url: commitPath,
    })
  } else {
    app.post(commitPath, commitHandler)
  }
}
