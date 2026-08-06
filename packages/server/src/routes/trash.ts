import type { DecoratedApp } from '../app'

export function registerTrashRoutes(app: DecoratedApp): void {
  app.delete('/api/nodes/:id', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node) return reply.code(404).send({ error: 'node not found' })
    app.deps.nodes.softDelete(node.id)
    return { ok: true }
  })

  app.post('/api/nodes/:id/restore', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node) return reply.code(404).send({ error: 'node not found' })
    app.deps.nodes.restore(node.id)
    return { ok: true }
  })

  app.get('/api/trees/:treeId/trash', async (request, reply) => {
    const tree = app.deps.trees.get(request.params.treeId)
    if (!tree) return reply.code(404).send({ error: 'tree not found' })
    return { nodes: app.deps.nodes.listDeleted(tree.id) }
  })
}
