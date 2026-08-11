import type { VisualAnnotationTarget } from '@vibe/shared'
import type { DecoratedApp } from '../app'

function bodyRecord(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null || (typeof value === 'number' && Number.isInteger(value))
    ? value
    : undefined
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

export function registerAnnotationRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/annotation', async (request, reply) => {
    const body = bodyRecord(request.body)
    const anchorFrom = nullableNumber(body?.anchorFrom ?? null)
    const anchorTo = nullableNumber(body?.anchorTo ?? null)
    const quotedText = nullableString(body?.quotedText ?? null)
    const note = typeof body?.note === 'string' ? body.note : undefined
    const rawTarget = body?.visualTarget
    const visualTarget = parseVisualTarget(rawTarget)
    if (
      anchorFrom === undefined ||
      anchorTo === undefined ||
      quotedText === undefined ||
      !note ||
      (rawTarget !== undefined && !visualTarget) ||
      !note.trim()
    ) {
      return reply.code(400).send({ error: 'invalid annotation body' })
    }

    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }

    const annotation = app.deps.annotations.create({
      anchorFrom,
      anchorTo,
      kind: visualTarget ? 'whole' : 'selection',
      nodeId: node.id,
      note: note.trim(),
      quotedText,
      visualTarget,
    })
    return { annotation }
  })
}

function parseVisualTarget(value: unknown): VisualAnnotationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  if (typeof target.artifactId !== 'string' || !target.artifactId.trim() || !Number.isInteger(target.revision) || (target.revision as number) < 1) return null
  const artifactId = target.artifactId.trim()
  const revision = target.revision as number
  if (target.target === 'whole') return { artifactId, revision, target: 'whole' }
  if (target.target === 'element' && ['node', 'edge', 'group'].includes(String(target.elementType)) && typeof target.elementId === 'string' && target.elementId.trim()) {
    return {
      artifactId,
      revision,
      target: 'element',
      elementType: target.elementType as 'node' | 'edge' | 'group',
      elementId: target.elementId.trim(),
    }
  }
  return null
}
