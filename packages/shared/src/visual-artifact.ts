export const VISUAL_SCHEMA_VERSION = 1 as const
export const VISUAL_SCENE_LIMITS = { nodes: 60, edges: 120 } as const

export const VISUAL_KINDS = ['architecture', 'flow', 'sequence', 'mindmap', 'comparison'] as const
export type VisualKind = (typeof VISUAL_KINDS)[number]
export const VISUAL_RENDERERS = ['svg', 'canvas'] as const
export type VisualRenderer = (typeof VISUAL_RENDERERS)[number]

export interface VisualNode {
  id: string
  label: string
  description?: string
  kind?: string
  groupId?: string
  data?: Record<string, string | number | boolean | null>
}

export interface VisualEdge {
  id: string
  source: string
  target: string
  label?: string
  kind?: string
  directed?: boolean
}

export interface VisualGroup {
  id: string
  label: string
  nodeIds: string[]
  parentGroupId?: string
}

export interface VisualScene {
  schemaVersion: typeof VISUAL_SCHEMA_VERSION
  kind: VisualKind
  title: string
  altText: string
  renderer: VisualRenderer
  nodes: VisualNode[]
  edges: VisualEdge[]
  groups: VisualGroup[]
}

/** Stable ProseMirror payload. Documents reference a revision, never renderer output. */
export interface VisualReference {
  artifactId: string
  revision: number
  altText: string
}

export interface VisualArtifact extends VisualScene {
  artifactId: string
  revision: number
}

export type VisualStreamEvent =
  | { type: 'visual_placeholder'; placeholderId: string; artifactId: string; revision: number }
  | { type: 'visual_ready'; placeholderId: string; artifactId: string; revision: number; artifact: VisualArtifact }
  | { type: 'visual_error'; placeholderId: string; artifactId: string; revision: number; reason: string; fallback: 'text' }

export type ValidationResult<T> = { success: true; value: T } | { success: false; errors: string[] }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const unique = (values: Array<{ id: string }>): boolean => new Set(values.map((value) => value.id)).size === values.length
const FORBIDDEN_KEY = /^(?:on[a-z]+|script|html|javascript|js|href|url|src)$/i
const FORBIDDEN_VALUE = /(?:<\/?[a-z][^>]*>|javascript\s*:|https?:\/\/|data\s*:\s*text\/html)/i

function unsafePath(value: unknown, path = 'scene'): string | undefined {
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) return path
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = unsafePath(value[index], `${path}[${index}]`)
      if (found) return found
    }
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) return `${path}.${key}`
      const found = unsafePath(child, `${path}.${key}`)
      if (found) return found
    }
  }
  return undefined
}

function isNode(value: unknown): value is VisualNode {
  if (!record(value) || !nonEmpty(value.id) || !nonEmpty(value.label)) return false
  if (value.description !== undefined && typeof value.description !== 'string') return false
  if (value.kind !== undefined && !nonEmpty(value.kind)) return false
  if (value.groupId !== undefined && !nonEmpty(value.groupId)) return false
  return value.data === undefined || (record(value.data) && Object.values(value.data).every((item) =>
    item === null || ['string', 'number', 'boolean'].includes(typeof item)))
}

function isEdge(value: unknown): value is VisualEdge {
  return record(value) && nonEmpty(value.id) && nonEmpty(value.source) && nonEmpty(value.target)
    && (value.label === undefined || typeof value.label === 'string')
    && (value.kind === undefined || nonEmpty(value.kind))
    && (value.directed === undefined || typeof value.directed === 'boolean')
}

function isGroup(value: unknown): value is VisualGroup {
  return record(value) && nonEmpty(value.id) && nonEmpty(value.label)
    && Array.isArray(value.nodeIds) && value.nodeIds.every(nonEmpty)
    && (value.parentGroupId === undefined || nonEmpty(value.parentGroupId))
}

export function validateVisualReference(value: unknown): ValidationResult<VisualReference> {
  const errors: string[] = []
  if (!record(value)) return { success: false, errors: ['reference must be an object'] }
  if (!nonEmpty(value.artifactId)) errors.push('artifactId must be a non-empty string')
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) errors.push('revision must be a positive integer')
  if (!nonEmpty(value.altText)) errors.push('altText must be a non-empty string')
  const unsafe = unsafePath(value, 'reference')
  if (unsafe) errors.push(`unsafe content at ${unsafe}`)
  return errors.length ? { success: false, errors } : { success: true, value: value as unknown as VisualReference }
}

export function validateVisualScene(value: unknown): ValidationResult<VisualScene> {
  const errors: string[] = []
  if (!record(value)) return { success: false, errors: ['scene must be an object'] }
  const unsafe = unsafePath(value)
  if (unsafe) errors.push(`unsafe content at ${unsafe}`)
  if (value.schemaVersion !== VISUAL_SCHEMA_VERSION) errors.push('unsupported schemaVersion')
  if (!VISUAL_KINDS.includes(value.kind as VisualKind)) errors.push('unsupported kind')
  if (!nonEmpty(value.title)) errors.push('title must be a non-empty string')
  if (!nonEmpty(value.altText)) errors.push('altText must be a non-empty string')
  if (!VISUAL_RENDERERS.includes(value.renderer as VisualRenderer)) errors.push('unsupported renderer')
  if (!Array.isArray(value.nodes) || !value.nodes.every(isNode)) errors.push('nodes are invalid')
  if (!Array.isArray(value.edges) || !value.edges.every(isEdge)) errors.push('edges are invalid')
  if (!Array.isArray(value.groups) || !value.groups.every(isGroup)) errors.push('groups are invalid')
  if (errors.length) return { success: false, errors }

  const scene = value as unknown as VisualScene
  if (scene.nodes.length > VISUAL_SCENE_LIMITS.nodes) errors.push(`nodes exceed limit ${VISUAL_SCENE_LIMITS.nodes}`)
  if (scene.edges.length > VISUAL_SCENE_LIMITS.edges) errors.push(`edges exceed limit ${VISUAL_SCENE_LIMITS.edges}`)
  if (!unique(scene.nodes)) errors.push('node ids must be unique')
  if (!unique(scene.edges)) errors.push('edge ids must be unique')
  if (!unique(scene.groups)) errors.push('group ids must be unique')
  const nodeIds = new Set(scene.nodes.map((node) => node.id))
  const groupIds = new Set(scene.groups.map((group) => group.id))
  if (scene.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) errors.push('edge endpoints must reference nodes')
  if (scene.nodes.some((node) => node.groupId !== undefined && !groupIds.has(node.groupId))) errors.push('node groupId must reference a group')
  if (scene.groups.some((group) => group.nodeIds.some((id) => !nodeIds.has(id))
    || (group.parentGroupId !== undefined && !groupIds.has(group.parentGroupId)))) errors.push('group references are invalid')
  return errors.length ? { success: false, errors } : { success: true, value: scene }
}

export function validateVisualArtifact(value: unknown): ValidationResult<VisualArtifact> {
  const scene = validateVisualScene(value)
  if (!scene.success) return scene
  if (!record(value) || !nonEmpty(value.artifactId)) return { success: false, errors: ['artifactId must be a non-empty string'] }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return { success: false, errors: ['revision must be a positive integer'] }
  return { success: true, value: value as unknown as VisualArtifact }
}
