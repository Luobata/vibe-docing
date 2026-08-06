import type { RouteTarget } from '@vibe/shared'

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

export const DEFAULT_ROUTE_THRESHOLDS: RouteThresholds = {
  highConfidence: 0.7,
  leadMargin: 0.2,
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

export const MAIN_CONTINUATION_FALLBACK: RouteCandidate = {
  label: '主文档延续',
  refId: null,
  score: 1,
  target: 'main-continuation',
}

