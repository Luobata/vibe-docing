import {
  DEFAULT_ROUTE_THRESHOLDS,
  MAIN_CONTINUATION_FALLBACK,
  type RouteCandidate,
  type RouteConvergence,
  type RouteThresholds,
} from './route-types'

const boundaryTolerance = 1e-12

function validScore(score: number): boolean {
  return Number.isFinite(score) && score >= 0 && score <= 1
}

function normalizeThresholds(
  overrides: Partial<RouteThresholds> | undefined,
): RouteThresholds {
  const thresholds = { ...DEFAULT_ROUTE_THRESHOLDS, ...overrides }
  if (
    !validScore(thresholds.highConfidence) ||
    !validScore(thresholds.leadMargin)
  ) {
    return { ...DEFAULT_ROUTE_THRESHOLDS }
  }
  return thresholds
}

export function convergeRouteCandidates(
  candidates: RouteCandidate[],
  overrides?: Partial<RouteThresholds>,
): RouteConvergence {
  const thresholds = normalizeThresholds(overrides)
  const sorted = candidates
    .filter((candidate) => validScore(candidate.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)

  if (sorted.length === 0) {
    return {
      candidates: [],
      fallback: { ...MAIN_CONTINUATION_FALLBACK },
      reason: 'no valid route candidates',
      state: 'failed',
      thresholds,
    }
  }

  const chosen = sorted[0]
  const secondScore = sorted[1]?.score ?? 0
  const isHighConfidence =
    chosen.score + boundaryTolerance >= thresholds.highConfidence
  const hasClearLead =
    chosen.score - secondScore + boundaryTolerance >= thresholds.leadMargin

  if (!isHighConfidence || !hasClearLead) {
    return {
      candidates: sorted,
      fallback: { ...MAIN_CONTINUATION_FALLBACK },
      state: 'ambiguous',
      thresholds,
    }
  }

  return {
    candidates: sorted,
    chosen,
    fallback: { ...MAIN_CONTINUATION_FALLBACK },
    state:
      chosen.target === 'main-continuation'
        ? 'consistent'
        : 'high-confidence-elsewhere',
    thresholds,
  }
}
