import type { DecoratedApp } from '../app'
import { MaterialError } from '../repo/material-repo'
import type { AppReply } from '../http/app-instance'

const record = (body: unknown) => body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
function sendError(reply: AppReply, error: unknown) {
  if (error instanceof MaterialError) return reply.code(error.statusCode).send({ code: error.code, error: error.message })
  throw error
}

export function registerMaterialRoutes(app: DecoratedApp): void {
  const { deps } = app
  const active = (id: string) => {
    const material = deps.materials.get(id)
    return material && deps.trees.get(material.tree_id) ? material : undefined
  }
  app.get('/api/trees/:treeId/materials', async (request, reply) => {
    if (!deps.trees.get(request.params.treeId)) return reply.code(404).send({ error: 'tree not found' })
    return { materials: deps.materials.listByTree(request.params.treeId) }
  })
  app.post('/api/trees/:treeId/materials', async (request, reply) => {
    if (!deps.trees.get(request.params.treeId)) return reply.code(404).send({ error: 'tree not found' })
    const body = record(request.body)
    if (!body || typeof body.content !== 'string' || (body.title !== undefined && typeof body.title !== 'string')) {
      return reply.code(400).send({ code: 'INVALID_MATERIAL', error: '请提供文本素材及可选标题' })
    }
    try {
      const result = deps.materials.create(request.params.treeId, { content: body.content, title: body.title as string | undefined })
      return reply.code(result.created ? 201 : 200).send({ material: result.material })
    } catch (error) { return sendError(reply, error) }
  })
  app.patch('/api/materials/:id', async (request, reply) => {
    if (!active(request.params.id)) return reply.code(404).send({ error: 'material not found' })
    const body = record(request.body)
    if (!body || (body.content === undefined && body.title === undefined && body.enabled === undefined)
      || (body.content !== undefined && typeof body.content !== 'string')
      || (body.title !== undefined && typeof body.title !== 'string')
      || (body.enabled !== undefined && typeof body.enabled !== 'boolean' && body.enabled !== 0 && body.enabled !== 1)) {
      return reply.code(400).send({ code: 'INVALID_MATERIAL', error: '素材更新字段无效' })
    }
    try {
      return { material: deps.materials.update(request.params.id, { content: body.content as string | undefined,
        title: body.title as string | undefined, enabled: body.enabled === undefined ? undefined : Boolean(body.enabled) }) }
    } catch (error) { return sendError(reply, error) }
  })
  app.delete('/api/materials/:id', async (request, reply) => {
    if (!active(request.params.id)) return reply.code(404).send({ error: 'material not found' })
    deps.materials.remove(request.params.id)
    return { ok: true }
  })
}
