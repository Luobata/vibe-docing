import type { DecoratedApp } from '../app'
import { resolveProvider } from '../provider/registry'
import { createRouteDecisionService } from '../service/route-decision-service'

export function registerRouteConvergeRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/route', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    if (!node.parent_id || !node.user_input?.trim()) {
      return reply.code(400).send({ error: 'node is not a routable optimistic answer' })
    }

    const provider = resolveProvider(
      { settings: app.deps.settings },
      app.deps.providerOverride,
    )
    return createRouteDecisionService({
      annotations: app.deps.annotations,
      context: app.deps.context,
      nodes: app.deps.nodes,
      provider,
      settings: app.deps.settings,
    }).route({ answerNodeId: node.id })
  })
}

