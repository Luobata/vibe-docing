import type { DecoratedApp } from '../app'
import { documentContentOf } from '@vibe/shared'

function recordBody(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
}

function validProseMirror(value: string): boolean {
  try {
    const document = JSON.parse(value) as { type?: unknown }
    return document.type === 'doc'
  } catch {
    return false
  }
}

export function registerNodeEditRoutes(app: DecoratedApp): void {
  app.put('/api/nodes/:id/tags', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) return reply.code(404).send({ error: 'node not found' })
    const body = recordBody(request.body)
    if (!body || !Array.isArray(body.tags)) return reply.code(400).send({ error: 'tags must be an array' })
    const updated = app.deps.nodes.updateTags(node.id, body.tags as unknown[])
    return { node: updated }
  })

  app.post('/api/nodes/:id/move', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) return reply.code(404).send({ error: 'node not found' })
    const body = recordBody(request.body)
    const directory = body?.directory
    if (typeof directory !== 'string' || directory.length > 200) {
      return reply.code(400).send({ error: 'invalid directory' })
    }
    const moved = app.deps.vault.moveNodeFile(node, directory)
    return { node: app.deps.vault.hydrateNode(moved) }
  })

  app.post('/api/nodes/:id/children', async (request, reply) => {
    const parent = app.deps.nodes.get(request.params.id)
    if (!parent || parent.is_deleted === 1) {
      return reply.code(404).send({ error: 'parent node not found' })
    }
    const body = recordBody(request.body)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > 200) {
      return reply.code(400).send({ error: 'invalid note title' })
    }

    const createBlankNote = app.deps.db.transaction(() => {
      const created = app.deps.nodes.create({
        parentId: parent.id,
        status: 'complete',
        treeId: parent.tree_id,
        userInput: title,
      })
      const node = app.deps.nodes.updateContent(created.id, {
        contentSchemaVersion: 2,
        documentContent: '',
        status: 'complete',
      })
      app.deps.versions.snapshot({
        aiResponse: node.ai_response,
        changeKind: 'edit',
        documentContent: '',
        nodeId: node.id,
        userInput: node.user_input,
      })
      return node
    })
    return { node: createBlankNote() }
  })

  app.patch('/api/nodes/:id', async (request, reply) => {
    const body = recordBody(request.body)
    const hasUserInput = body && Object.hasOwn(body, 'userInput')
    const hasAiResponse = body && Object.hasOwn(body, 'aiResponse')
    const userInput = body?.userInput
    const aiResponse = body?.aiResponse
    if (
      !body ||
      (!hasUserInput && !hasAiResponse) ||
      (hasUserInput && userInput !== null && typeof userInput !== 'string') ||
      (hasAiResponse && aiResponse !== null && typeof aiResponse !== 'string') ||
      (typeof aiResponse === 'string' && !validProseMirror(aiResponse))
    ) {
      return reply.code(400).send({ error: 'invalid node edit body' })
    }

    const existing = app.deps.nodes.get(request.params.id)
    if (!existing || existing.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const node = app.deps.nodes.updateContent(existing.id, {
      // aiResponse is retained as a deprecated request key for older clients;
      // edits now target the document body and never rewrite model evidence.
      documentContent: hasAiResponse ? (aiResponse as string | null) : undefined,
      userInput: hasUserInput ? (userInput as string | null) : undefined,
    })
    app.deps.versions.snapshot({
      aiResponse: node.ai_response,
      documentContent: documentContentOf(node),
      changeKind: 'edit',
      nodeId: node.id,
      userInput: node.user_input,
    })
    return { node }
  })
}
