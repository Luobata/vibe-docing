import type { DecoratedApp } from '../app'
import { prosemirrorToPlainText } from '../context/prosemirror'
import { lineDiff } from '../service/diff'

function versionNumber(value: string): number | undefined {
  return /^[1-9]\d*$/.test(value) ? Number(value) : undefined
}

export function registerVersionRoutes(app: DecoratedApp): void {
  app.get('/api/nodes/:id/versions', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    return { versions: app.deps.versions.listByNode(node.id) }
  })

  app.get('/api/nodes/:id/versions/:from/diff/:to', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const from = versionNumber(request.params.from)
    const to = versionNumber(request.params.to)
    if (from === undefined || to === undefined) {
      return reply.code(400).send({ error: 'invalid version number' })
    }
    const before = app.deps.versions.get(node.id, from)
    const after = app.deps.versions.get(node.id, to)
    if (!before || !after) {
      return reply.code(404).send({ error: 'version not found' })
    }
    return {
      diff: lineDiff(
        prosemirrorToPlainText(before.ai_response),
        prosemirrorToPlainText(after.ai_response),
      ),
    }
  })

  app.post('/api/nodes/:id/versions/:versionNo/revert', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const versionNo = versionNumber(request.params.versionNo)
    if (versionNo === undefined) {
      return reply.code(400).send({ error: 'invalid version number' })
    }
    const version = app.deps.versions.get(node.id, versionNo)
    if (!version) return reply.code(404).send({ error: 'version not found' })

    const revert = app.deps.db.transaction(() => {
      const updated = app.deps.nodes.updateContent(node.id, {
        aiResponse: version.ai_response,
        userInput: version.user_input,
      })
      app.deps.versions.snapshot({
        aiResponse: updated.ai_response,
        changeKind: 'edit',
        nodeId: updated.id,
        userInput: updated.user_input,
      })
      return updated
    })
    return { node: revert() }
  })
}
