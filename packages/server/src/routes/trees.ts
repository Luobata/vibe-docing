import type { NodeRow } from '@vibe/shared'
import type { DecoratedApp } from '../app'

function objectBody(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
}

export function registerTreeRoutes(app: DecoratedApp): void {
  app.post('/api/trees', async (request, reply) => {
    const title = objectBody(request.body)?.title
    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(400).send({ error: 'invalid title' })
    }
    const created = app.deps.trees.create(title.trim())
    return { ...created, rootNode: app.deps.vault.ensureNodeFile(created.rootNode) }
  })

  app.get('/api/trees', async () => {
    app.deps.vault.sync()
    return { trees: app.deps.trees.list() }
  })

  app.get('/api/trees/deleted', async () => ({
    trees: app.deps.trees.listDeleted(),
  }))

  app.patch('/api/trees/:id', async (request, reply) => {
    const title = objectBody(request.body)?.title
    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(400).send({ error: 'invalid title' })
    }
    if (!app.deps.trees.get(request.params.id)) {
      return reply.code(404).send({ error: 'tree not found' })
    }
    return { tree: app.deps.trees.rename(request.params.id, title.trim()) }
  })

  app.delete('/api/trees/:id', async (request, reply) => {
    if (!app.deps.trees.get(request.params.id)) {
      return reply.code(404).send({ error: 'tree not found' })
    }
    app.deps.trees.softDelete(request.params.id)
    return { ok: true }
  })

  app.post('/api/trees/:id/restore', async (request, reply) => {
    const tree = app.deps.trees.restore(request.params.id)
    if (!tree) {
      return reply.code(404).send({ error: 'deleted tree not found' })
    }
    return { tree }
  })

  app.get('/api/trees/:id', async (request, reply) => {
    const tree = app.deps.trees.get(request.params.id)
    if (!tree) return reply.code(404).send({ error: 'tree not found' })

    const nodes = app.deps.db
      .prepare(
        `SELECT * FROM nodes
         WHERE tree_id = ? AND is_deleted = 0
         ORDER BY (parent_id IS NOT NULL) ASC, created_at ASC, sort_order ASC, id ASC`,
      )
      .all(tree.id) as NodeRow[]
    return {
      annotations: app.deps.annotations.listByTree(tree.id),
      merges: app.deps.merges.listByTree(tree.id),
      nodes: nodes.map(app.deps.vault.hydrateNode),
      tree,
    }
  })

  app.get('/api/nodes/:id/path', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const path = app.deps.nodes
      .getPathToRoot(node.id)
      .filter((ancestor) => ancestor.is_deleted === 0)
    return { path }
  })

  app.get('/api/nodes/:id', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const current = app.deps.vault.hydrateNode(node)
    return {
      annotations: app.deps.annotations.listByNode(node.id),
      node: current,
      segments: app.deps.segments.listByNode(node.id),
    }
  })
}
