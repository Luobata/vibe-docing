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

