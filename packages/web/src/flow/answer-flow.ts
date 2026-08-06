import type { RouteCandidate, RouteConvergence } from '../api/types'

export type RouteUi =
  | { action: 'none' }
  | { action: 'suggest'; candidate: RouteCandidate }
  | { action: 'ask'; candidates: RouteCandidate[] }

let temporarySequence = 0

export function nextTempId(): string {
  temporarySequence += 1
  return `tmp-${temporarySequence}`
}

export function decideRouteUi(convergence: RouteConvergence): RouteUi {
  if (convergence.state === 'high-confidence-elsewhere' && convergence.chosen) {
    return { action: 'suggest', candidate: convergence.chosen }
  }
  if (convergence.state === 'ambiguous') {
    return { action: 'ask', candidates: convergence.candidates }
  }
  return { action: 'none' }
}

export function resolveMigrationParent(
  candidate: RouteCandidate,
  optimisticParentId: string,
): string {
  // new-branch refs identify annotation anchors, not nodes. The already-created
  // answer is the new branch, so it stays under the optimistic main parent.
  return candidate.target === 'bound-subdoc' && candidate.refId
    ? candidate.refId
    : optimisticParentId
}
