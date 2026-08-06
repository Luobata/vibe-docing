import { describe, expect, it } from 'vitest'
import { convergeRouteCandidates } from './route-convergence'
import type { RouteCandidate } from './route-types'

function candidate(
  target: RouteCandidate['target'],
  score: number,
  refId: string | null = null,
): RouteCandidate {
  return { label: target, refId, score, target }
}

describe('convergeRouteCandidates', () => {
  it('is consistent when the optimistic main continuation clearly wins', () => {
    const result = convergeRouteCandidates([
      candidate('bound-subdoc', 0.4, 'child-1'),
      candidate('main-continuation', 0.8),
    ])

    expect(result.state).toBe('consistent')
    expect(result.candidates.map((item) => item.score)).toEqual([0.8, 0.4])
  })

  it('reports a high-confidence alternative at both inclusive boundaries', () => {
    const result = convergeRouteCandidates([
      candidate('main-continuation', 0.5),
      candidate('new-branch', 0.7, 'annotation-1'),
    ])

    expect(result.state).toBe('high-confidence-elsewhere')
    expect(result.chosen?.target).toBe('new-branch')
  })

  it('is ambiguous when the leader is below the high threshold or too close', () => {
    expect(
      convergeRouteCandidates([
        candidate('new-branch', 0.69, 'annotation-1'),
        candidate('main-continuation', 0.2),
      ]).state,
    ).toBe('ambiguous')
    expect(
      convergeRouteCandidates([
        candidate('bound-subdoc', 0.85, 'child-1'),
        candidate('main-continuation', 0.66),
      ]).state,
    ).toBe('ambiguous')
  })

  it('fails closed to main continuation when candidates are unusable', () => {
    const result = convergeRouteCandidates([
      candidate('new-branch', Number.NaN, 'annotation-1'),
    ])

    expect(result.state).toBe('failed')
    expect(result.fallback.target).toBe('main-continuation')
  })

  it('accepts adjustable thresholds and limits ambiguous choices to top three', () => {
    const result = convergeRouteCandidates(
      [
        candidate('bound-subdoc', 0.61, 'child-1'),
        candidate('main-continuation', 0.5),
        candidate('new-branch', 0.4, 'annotation-1'),
        candidate('new-branch', 0.3, 'annotation-2'),
      ],
      { highConfidence: 0.6, leadMargin: 0.1 },
    )

    expect(result.state).toBe('high-confidence-elsewhere')
    expect(result.candidates).toHaveLength(3)
  })
})
