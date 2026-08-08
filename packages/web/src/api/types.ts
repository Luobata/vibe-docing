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

export interface SettingsView {
  baseUrl: string | null
  hasApiKey: boolean
  model: string
  projectRoot: string | null
  provider: string
}

export interface SettingsPatch {
  apiKey?: string
  baseUrl?: string
  model?: string
  projectRoot?: string
  provider?: string
}

