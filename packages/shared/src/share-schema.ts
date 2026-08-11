import type { AnnotationKind, NodeStatus } from './types'
import type { VisualScene } from './visual-artifact'
import { sceneLayout, type SceneLayout } from './visual-layout'

export const PUBLIC_SHARE_SCHEMA_VERSION = 1 as const

export interface PublicShareArtifact extends VisualScene {
  /** Coordinates are deterministic presentation geometry, not persisted authoring data. */
  derivedLayout: SceneLayout
}

export interface PublicShareSnapshot {
  schemaVersion: typeof PUBLIC_SHARE_SCHEMA_VERSION
  share: {
    scope: 'node' | 'tree'
    title: string
    createdAt: string
    updatedAt: string
  }
  nodes: Array<{
    index: number
    depth: number
    parentIndex: number | null
    title: string
    inputText: string
    responseText: string
    visualRefs: Array<{ index: number; altText: string }>
    status: NodeStatus
  }>
  relations: {
    derivations: Array<{
      fromNodeIndex: number
      quotedText: string | null
      note: string | null
      toNodeIndex: number
    }>
  }
  annotations: Array<{
    nodeIndex: number
    kind: AnnotationKind
    quotedText: string | null
    note: string | null
  }>
  artifacts: PublicShareArtifact[]
}

export type PublicShareSnapshotInput = Omit<PublicShareSnapshot, 'schemaVersion' | 'artifacts'> & {
  artifacts: VisualScene[]
}

export function buildPublicShareSnapshot(input: PublicShareSnapshotInput): PublicShareSnapshot {
  return {
    schemaVersion: PUBLIC_SHARE_SCHEMA_VERSION,
    ...input,
    artifacts: input.artifacts.map((artifact) => ({ ...artifact, derivedLayout: sceneLayout(artifact) })),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function validatePublicShareSnapshot(value: unknown):
  | { success: true; value: PublicShareSnapshot }
  | { success: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(value)) return { success: false, errors: ['snapshot must be an object'] }
  if (value.schemaVersion !== PUBLIC_SHARE_SCHEMA_VERSION) errors.push('unsupported schemaVersion')
  if (!isRecord(value.share) || !['node', 'tree'].includes(String(value.share.scope))
    || typeof value.share.title !== 'string' || typeof value.share.createdAt !== 'string'
    || typeof value.share.updatedAt !== 'string') errors.push('share is invalid')
  if (!Array.isArray(value.nodes) || value.nodes.some((node, index) => !isRecord(node)
    || node.index !== index || !Number.isInteger(node.depth) || (node.depth as number) < 0
    || !(node.parentIndex === null || (Number.isInteger(node.parentIndex) && (node.parentIndex as number) < index))
    || typeof node.title !== 'string' || typeof node.inputText !== 'string'
    || typeof node.responseText !== 'string' || !Array.isArray(node.visualRefs))) errors.push('nodes are invalid')
  if (!isRecord(value.relations) || !Array.isArray(value.relations.derivations)) errors.push('relations are invalid')
  if (!Array.isArray(value.annotations)) errors.push('annotations are invalid')
  if (!Array.isArray(value.artifacts) || value.artifacts.some((artifact) => !isRecord(artifact)
    || !isRecord(artifact.derivedLayout))) errors.push('artifacts are invalid')
  return errors.length
    ? { success: false, errors }
    : { success: true, value: value as unknown as PublicShareSnapshot }
}
