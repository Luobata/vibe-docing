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

export const CHANGE_KINDS = ['edit', 'merge', 'regenerate', 'correction'] as const
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
  /** 笔记库所属文件夹（斜杠分隔路径）；null = 未分组。 */
  folder?: string | null
  is_deleted: 0 | 1
  created_at: string
  updated_at: string
}

export interface NodeRow {
  verdict?: 'adopted' | 'rejected' | 'superseded' | null
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
  /** JSON 字符串数组：AI 自动生成、用户可编辑的标签。 */
  tags_json?: string | null
}

/** 标签清洗：去空白/截 16 字/去重/限 8 个。生成与编辑两侧共用同一纪律。 */
export function sanitizeTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 16)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 8) break
  }
  return out
}

/** 解析节点 tags_json；非法或缺失返回空数组。 */
export function parseNodeTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return []
  try {
    return sanitizeTagList(JSON.parse(tagsJson))
  } catch {
    return []
  }
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
  landing_segment_id: string | null
  /** Present on migrated/current APIs; optional keeps cached pre-migration graph payloads readable. */
  kind?: 'summary' | 'correction'
  direction?: string | null
  created_at: string
}

export type CorrectionMode = 'patch' | 'append' | 'rewrite'

export interface CorrectionPatchPair {
  quote: string
  replacement: string
}

export type CorrectDraft =
  | {
      mode: 'patch'
      pairs: CorrectionPatchPair[]
      unmatched: {
        heading: '纠正附注'
        strategy: 'append-note'
      }
    }
  | {
      mode: 'append'
      section: {
        title: string
        body: string
      }
    }
  | {
      fullText: string
      mode: 'rewrite'
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
  synthesisId?: string
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
