import { VISUAL_KINDS, VISUAL_RENDERERS, VISUAL_SCHEMA_VERSION, validateVisualScene, type VisualArtifact } from '@vibe/shared'
import type { createVisualArtifactRepo } from '../repo/visual-artifact-repo'

type VisualArtifactRepo = ReturnType<typeof createVisualArtifactRepo>

export const CREATE_VISUAL_TOOL_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'create_visual',
    description: 'Create one constrained renderer-neutral visual for hierarchy, flow, sequence, or at least three dependencies. Never include HTML, JavaScript, handlers, or external links. Fall back to text on failure.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: VISUAL_KINDS },
        title: { type: 'string' }, altText: { type: 'string' },
        renderer: { type: 'string', enum: VISUAL_RENDERERS },
        nodes: { type: 'array', maxItems: 60, items: { type: 'object' } },
        edges: { type: 'array', maxItems: 120, items: { type: 'object' } },
        groups: { type: 'array', items: { type: 'object' } },
      },
      required: ['kind', 'title', 'altText', 'renderer', 'nodes', 'edges', 'groups'],
    },
  },
}

export function createVisualArtifactFromTool(input: {
  argsJson: string
  artifactId: string
  revision: number
  artifacts: VisualArtifactRepo
}): VisualArtifact {
  let args: unknown
  try { args = JSON.parse(input.argsJson) } catch { throw new Error('create_visual arguments must be valid JSON') }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('create_visual scene must be an object')
  const scene = { ...args, schemaVersion: VISUAL_SCHEMA_VERSION }
  const validated = validateVisualScene(scene)
  if (!validated.success) throw new Error(`create_visual validation failed: ${validated.errors.join('; ')}`)
  return input.artifacts.create({ ...validated.value, artifactId: input.artifactId, revision: input.revision })
}
