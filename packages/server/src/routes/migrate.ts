import type { RouteTarget } from '@vibe/shared'
import type { DecoratedApp } from '../app'
import {
  createMigrateService,
  InvalidMigrationError,
  MigrateNotFoundError,
} from '../service/migrate-service'

const routeTargets = new Set<RouteTarget>([
  'main-continuation',
  'bound-subdoc',
  'new-branch',
])

function bodyRecord(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
}

export function registerMigrateRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/migrate', async (request, reply) => {
    const body = bodyRecord(request.body)
    const target = body?.target
    const newParentId = body?.newParentId
    const seedText = body?.seedText
    if (
      typeof target !== 'string' ||
      !routeTargets.has(target as RouteTarget) ||
      typeof newParentId !== 'string' ||
      !newParentId.trim() ||
      (seedText !== undefined && typeof seedText !== 'string')
    ) {
      return reply.code(400).send({ error: 'invalid migrate body' })
    }

    try {
      const node = createMigrateService(app.deps).migrate({
        newParentId,
        nodeId: request.params.id,
        seedText: typeof seedText === 'string' ? seedText : undefined,
        target: target as RouteTarget,
      })
      return { node, path: app.deps.nodes.getPathToRoot(node.id) }
    } catch (error) {
      if (error instanceof MigrateNotFoundError) {
        return reply.code(404).send({ error: error.message })
      }
      if (error instanceof InvalidMigrationError) {
        return reply.code(400).send({ error: error.message })
      }
      throw error
    }
  })
}

