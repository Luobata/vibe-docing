import type { DecoratedApp } from '../app'

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
      aiResponse: hasAiResponse ? (aiResponse as string | null) : undefined,
      userInput: hasUserInput ? (userInput as string | null) : undefined,
    })
    app.deps.versions.snapshot({
      aiResponse: node.ai_response,
      changeKind: 'edit',
      nodeId: node.id,
      userInput: node.user_input,
    })
    return { node }
  })
}
