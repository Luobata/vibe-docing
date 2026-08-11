import type { DecoratedApp } from '../app'
import { renderShareHtml, renderShareMarkdown } from '../service/share-renderer'

const publicHeaders = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex,nofollow',
}

export function registerShareRoutes(app: DecoratedApp): void {
  const shareableNode = (nodeId: string) => {
    const node = app.deps.nodes.get(nodeId)
    if (!node || node.is_deleted || !app.deps.trees.get(node.tree_id)) return undefined
    return node
  }

  app.get('/api/nodes/:nodeId/share', async (request, reply) => {
    const node = shareableNode(request.params.nodeId)
    if (!node) return reply.code(404).send({ code: 'NODE_NOT_FOUND' })
    return { share: app.deps.share.get(node.id) }
  })
  app.post('/api/nodes/:nodeId/share', async (request, reply) => {
    const node = shareableNode(request.params.nodeId)
    if (!node) return reply.code(404).send({ code: 'NODE_NOT_FOUND' })
    return { share: app.deps.share.create(node.tree_id, node.id) }
  })
  app.delete('/api/nodes/:nodeId/share', async (request, reply) => {
    const node = shareableNode(request.params.nodeId)
    if (!node) return reply.code(404).send({ code: 'NODE_NOT_FOUND' })
    if (!app.deps.share.revoke(node.id)) return reply.code(404).send({ code: 'SHARE_NOT_FOUND' })
    return { ok: true }
  })

  // Compatibility: legacy tree-scoped calls continue to target the root node.
  app.get('/api/trees/:treeId/share', async (request, reply) => {
    const tree = app.deps.trees.get(request.params.treeId)
    if (!tree?.root_node_id) return reply.code(404).send({ code: 'TREE_NOT_FOUND' })
    return { share: app.deps.share.get(tree.root_node_id) }
  })
  app.post('/api/trees/:treeId/share', async (request, reply) => {
    const tree = app.deps.trees.get(request.params.treeId)
    if (!tree?.root_node_id) return reply.code(404).send({ code: 'TREE_NOT_FOUND' })
    return { share: app.deps.share.create(tree.id, tree.root_node_id) }
  })
  app.delete('/api/trees/:treeId/share', async (request, reply) => {
    const tree = app.deps.trees.get(request.params.treeId)
    if (!tree?.root_node_id) return reply.code(404).send({ code: 'TREE_NOT_FOUND' })
    if (!app.deps.share.revoke(tree.root_node_id)) return reply.code(404).send({ code: 'SHARE_NOT_FOUND' })
    return { ok: true }
  })

  const serve = async (token: string, asMarkdown: boolean, reply: any) => {
    for (const [name, value] of Object.entries(publicHeaders)) reply.header(name, value)
    const document = app.deps.share.documentForToken(token)
    if (!document) return reply.code(404).type('text/plain').send('Not Found')
    if (asMarkdown) return reply.type('text/markdown; charset=utf-8').send(renderShareMarkdown(document))
    return reply.type('text/html; charset=utf-8').send(renderShareHtml(document, `/share/${token}.md`))
  }
  app.get('/share/:token.md', async (request, reply) => serve(request.params.token, true, reply))
  app.get('/share/:token', async (request, reply) =>
    serve(
      request.params.token,
      String((request as unknown as { headers?: { accept?: string } }).headers?.accept ?? '').includes('text/markdown'),
      reply,
    ))
}
