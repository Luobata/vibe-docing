import type { AnnotationKind } from '@vibe/shared'
import type { DecoratedApp } from '../app'
import { createForkService } from '../service/fork-service'

function bodyRecord(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null || (typeof value === 'number' && Number.isInteger(value))
    ? value
    : undefined
}

export function registerForkRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/fork', async (request, reply) => {
    const body = bodyRecord(request.body)
    const kind = body?.kind
    const seedText = body?.seedText
    const treeId = body?.treeId
    const anchorFrom = nullableNumber(body?.anchorFrom ?? null)
    const anchorTo = nullableNumber(body?.anchorTo ?? null)
    const quotedText = nullableString(body?.quotedText ?? null)
    const note = nullableString(body?.note ?? null)
    if (
      (kind !== 'selection' && kind !== 'whole') ||
      typeof seedText !== 'string' ||
      !seedText.trim() ||
      typeof treeId !== 'string' ||
      !treeId ||
      anchorFrom === undefined ||
      anchorTo === undefined ||
      quotedText === undefined ||
      note === undefined ||
      (anchorFrom !== null && anchorFrom < 0) ||
      (anchorTo !== null && anchorTo < 0) ||
      (anchorFrom !== null && anchorTo !== null && anchorFrom > anchorTo)
    ) {
      return reply.code(400).send({ error: 'invalid fork body' })
    }

    const parent = app.deps.nodes.get(request.params.id)
    if (!parent || parent.is_deleted === 1) {
      return reply.code(404).send({ error: 'parent node not found' })
    }
    if (parent.tree_id !== treeId) {
      return reply.code(400).send({ error: 'parent tree mismatch' })
    }

    return createForkService(app.deps).fork({
      anchorFrom,
      anchorTo,
      kind: kind as AnnotationKind,
      note,
      parentNodeId: parent.id,
      quotedText,
      seedText: seedText.trim(),
      treeId,
    })
  })
}
