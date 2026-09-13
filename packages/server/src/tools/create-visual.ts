import { VISUAL_KINDS, VISUAL_RENDERERS, VISUAL_SCENE_LIMITS, VISUAL_SCHEMA_VERSION, validateVisualScene, type VisualArtifact } from '@vibe/shared'
import type { createVisualArtifactRepo } from '../repo/visual-artifact-repo'

type VisualArtifactRepo = ReturnType<typeof createVisualArtifactRepo>

const nonEmptyString = { type: 'string', pattern: '\\S' }

export const CREATE_VISUAL_TOOL_SCHEMA = {
  type: 'function' as const,
  function: {
    name: 'create_visual',
    description: 'Create one constrained renderer-neutral visual for hierarchy, flow, sequence, or at least three dependencies. Nodes, edges, and groups each need unique ids; edge source/target and group nodeIds reference node ids, while groupId/parentGroupId reference group ids. Never include HTML, JavaScript, handlers, or external links. Fall back to text on failure.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: VISUAL_KINDS },
        title: nonEmptyString, altText: nonEmptyString,
        renderer: { type: 'string', enum: VISUAL_RENDERERS },
        nodes: {
          type: 'array', maxItems: VISUAL_SCENE_LIMITS.nodes,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: nonEmptyString, label: nonEmptyString,
              description: { type: 'string' }, kind: nonEmptyString, groupId: nonEmptyString,
              data: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
            },
            required: ['id', 'label'],
          },
        },
        edges: {
          type: 'array', maxItems: VISUAL_SCENE_LIMITS.edges,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: nonEmptyString, source: nonEmptyString, target: nonEmptyString,
              label: { type: 'string' }, kind: nonEmptyString, directed: { type: 'boolean' },
            },
            required: ['id', 'source', 'target'],
          },
        },
        groups: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: nonEmptyString, label: nonEmptyString,
              nodeIds: { type: 'array', items: nonEmptyString }, parentGroupId: nonEmptyString,
            },
            required: ['id', 'label', 'nodeIds'],
          },
        },
      },
      required: ['kind', 'title', 'altText', 'renderer', 'nodes', 'edges', 'groups'],
    },
  },
}

const validationHints: Record<string, string> = {
  'nodes are invalid': 'nodes must be an array of { id: non-empty string, label: non-empty string, description?: string, kind?: non-empty string, groupId?: group id, data?: object with string/number/boolean/null values }',
  'edges are invalid': 'edges must be an array of { id: non-empty string, source: node id, target: node id, label?: string, kind?: non-empty string, directed?: boolean }; source and target must reference nodes[].id',
  'groups are invalid': 'groups must be an array of { id: non-empty string, label: non-empty string, nodeIds: array of node ids, parentGroupId?: group id }; nodeIds must reference nodes[].id',
  'edge endpoints must reference nodes': 'edge source and target must match existing nodes[].id',
  'group references are invalid': 'group nodeIds must match nodes[].id; parentGroupId must match groups[].id',
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
  if (!validated.success) {
    const errors = validated.errors.map((error) => validationHints[error] ? `${error}: ${validationHints[error]}` : error)
    throw new Error(`create_visual validation failed: ${errors.join('; ')}`)
  }
  return input.artifacts.create({ ...validated.value, artifactId: input.artifactId, revision: input.revision })
}
