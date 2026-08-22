export const NODE_STATUSES = [
  'draft',
  'streaming',
  'complete',
  'cancelled',
  'error',
] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const ANNOTATION_KINDS = ['selection', 'whole'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

export type VisualAnnotationTarget =
  | { artifactId: string; revision: number; target: 'whole' }
  | { artifactId: string; revision: number; target: 'element'; elementType: 'node' | 'edge' | 'group'; elementId: string }

export const SEGMENT_TYPES = [
  'ancestor-full',
  'ancestor-summary',
  'annotation-seed',
  'merged-conclusion',
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

export const CHANGE_KINDS = ['edit', 'merge', 'regenerate'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

export const ROUTE_TARGETS = [
  'main-continuation',
  'bound-subdoc',
  'new-branch',
] as const
export type RouteTarget = (typeof ROUTE_TARGETS)[number]

export interface TreeRow {
  id: string
  title: string
  root_node_id: string | null
  is_deleted: 0 | 1
  created_at: string
  updated_at: string
}

export interface NodeRow {
  id: string
  tree_id: string
  parent_id: string | null
  sort_order: number
  user_input: string | null
  /** Immutable evidence of the latest model generation. User edits must not write this field. */
  ai_response: string | null
  /** Canonical editable document body. Legacy rows may omit it and fall back to ai_response. */
  document_content?: string | null
  status: NodeStatus
  is_deleted: 0 | 1
  model_override: string | null
  created_at: string
  updated_at: string
  /** Monotonic revision of the editable document body. Older fixtures may omit it. */
  content_revision?: number
  /** 0 is the legacy markdown-in-paragraph representation; 1 is semantic ProseMirror JSON. */
  content_schema_version?: number
  content_updated_at?: string | null
  /** Vault-relative path. The file is the source of truth when present. */
  file_path?: string | null
  vault_root?: string | null
  file_kind?: 'markdown' | 'canvas' | 'base' | null
  content_hash?: string | null
}

export interface AnnotationRow {
  id: string
  node_id: string
  kind: AnnotationKind
  anchor_from: number | null
  anchor_to: number | null
  quoted_text: string | null
  note: string | null
  child_node_id: string | null
  created_at: string
  visual_target?: VisualAnnotationTarget | null
  anchor_status?: 'valid' | 'orphaned'
}

export interface ContextSegmentRow {
  id: string
  node_id: string
  seq: number
  type: SegmentType
  ref_node_id: string | null
  ref_version_no: number | null
  content: string | null
}

export interface NodeVersionRow {
  id: string
  node_id: string
  version_no: number
  user_input: string | null
  /** Model-generation evidence captured with this version. */
  ai_response: string | null
  /** Editable document body captured with this version. */
  document_content?: string | null
  change_kind: ChangeKind
  created_at: string
  edit_session_id?: string | null
  content_revision?: number | null
  updated_at?: string | null
}

/**
 * Read the editable document through the single legacy-compatibility boundary.
 * New writes target document_content; ai_response is only a fallback for rows
 * created before the fields were separated.
 */
export function documentContentOf(
  value: Pick<NodeRow, 'ai_response' | 'document_content'>
    | Pick<NodeVersionRow, 'ai_response' | 'document_content'>,
): string | null {
  return value.document_content ?? value.ai_response
}

export interface DocumentContentView {
  doc?: import('./prosemirror').ProseMirrorNode
  source?: string
  fileKind?: 'markdown' | 'canvas' | 'base'
  filePath?: string | null
  contentHash?: string | null
  nodeId: string
  revision: number
  schemaVersion: 0 | 1 | 2
  updatedAt: string | null
}

export interface DocumentAnchorPatch {
  from: number | null
  id: string
  quotedText: string | null
  status: 'valid' | 'orphaned'
  to: number | null
}

export interface MergeRow {
  id: string
  source_node_id: string
  target_node_id: string
  conclusion: string
  landing_segment_id: string
  created_at: string
}

export interface VisualArtifactRow {
  artifact_id: string
  revision: number
  kind: string
  title: string
  alt_text: string
  renderer: string
  schema_version: number
  scene_json: string
  created_at: string
  updated_at: string
}

/** Management API view. Tokens and hashes never cross this boundary. */
export interface DocumentShareView {
  enabled: true
  nodeId: string
  url: string
  markdownUrl: string
  jsonUrl: string
  createdAt: string
  updatedAt: string
}

export interface DocumentShareResponse {
  share: DocumentShareView | null
}
