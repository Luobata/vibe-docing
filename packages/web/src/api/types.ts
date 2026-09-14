import type { MergeRow, NodeRow, RouteTarget } from '@vibe/shared'

export interface Synthesis {
  id: string
  treeId: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  contentMd: string | null
  sections: Array<{ key: string; title: string; content: string }>
  footnotes: Array<{ number: number; nodeId: string; title: string; path: string[] }>
  nodeResults: Record<string, { nodeId: string; cacheKey: string; status: 'done' | 'failed'; content: string; error?: string; cached?: boolean }>
  inputDigest: string
  error: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}
export interface SynthesisProgress {
  synthesisId: string; nodeId: string; status: 'done' | 'failed'; completed: number; total: number; failed: number; cached: boolean
}
export interface OpenQuestion {
  id: string; tree_id: string; node_id: string | null; question: string; status: 'open' | 'resolved'
  source: 'ai' | 'manual'; resolved_at: string | null; created_at: string; updated_at: string
}
export interface Retrospective {
  id: string; tree_id: string; input_digest: string; content_md: string; created_at: string
}
export interface Decisions {
  merges: MergeRow[]
  nodes: Array<Pick<NodeRow, 'id' | 'parent_id' | 'user_input' | 'verdict' | 'updated_at'>>
}

export interface RouteCandidate {
  label: string
  refId: string | null
  score: number
  target: RouteTarget
}

export interface RouteThresholds {
  highConfidence: number
  leadMargin: number
}

export type RouteConvergenceState =
  | 'consistent'
  | 'high-confidence-elsewhere'
  | 'ambiguous'
  | 'failed'

export interface RouteConvergence {
  candidates: RouteCandidate[]
  chosen?: RouteCandidate
  fallback: RouteCandidate
  reason?: string
  state: RouteConvergenceState
  thresholds: RouteThresholds
}

export interface SettingsView {
  baseUrl: string | null
  hasApiKey: boolean
  model: string
  projectRoot: string | null
  provider: string
  vaultPath?: string
}

export interface SettingsPatch {
  apiKey?: string
  baseUrl?: string
  model?: string
  projectRoot?: string
  provider?: string
  vaultPath?: string
}
