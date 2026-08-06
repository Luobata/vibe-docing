export const NODE_STATUSES = ['draft', 'streaming', 'complete', 'error'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const ANNOTATION_KINDS = ['selection', 'whole'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

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
  created_at: string
  updated_at: string
}

export interface NodeRow {
  id: string
  tree_id: string
  parent_id: string | null
  sort_order: number
  user_input: string | null
  ai_response: string | null
  status: NodeStatus
  is_deleted: 0 | 1
  model_override: string | null
  created_at: string
  updated_at: string
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
  ai_response: string | null
  change_kind: ChangeKind
  created_at: string
}

export interface MergeRow {
  id: string
  source_node_id: string
  target_node_id: string
  conclusion: string
  landing_segment_id: string
  created_at: string
}
