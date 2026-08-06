import type { RouteCandidate, RouteConvergence } from '../api/types'
import { decideRouteUi, nextTempId, resolveMigrationParent } from './answer-flow'
import { describe, expect, it } from 'vitest'

const main: RouteCandidate = { label: '主文档', refId: null, score: 0.9, target: 'main-continuation' }
const branch: RouteCandidate = { label: 'Redis 分支', refId: 'child-1', score: 0.9, target: 'bound-subdoc' }
const anchor: RouteCandidate = { label: '缓存段落', refId: 'ann-1', score: 0.8, target: 'new-branch' }
const base = { fallback: main, thresholds: { highConfidence: 0.7, leadMargin: 0.2 } }

describe('answer flow', () => {
  it('maps the backend four-state convergence contract to UI', () => {
    expect(decideRouteUi({ ...base, candidates: [main], chosen: main, state: 'consistent' })).toEqual({ action: 'none' })
    expect(decideRouteUi({ ...base, candidates: [branch], chosen: branch, state: 'high-confidence-elsewhere' })).toEqual({ action: 'suggest', candidate: branch })
    expect(decideRouteUi({ ...base, candidates: [anchor, branch], state: 'ambiguous' })).toEqual({ action: 'ask', candidates: [anchor, branch] })
    expect(decideRouteUi({ ...base, candidates: [], reason: 'offline', state: 'failed' })).toEqual({ action: 'none' })
  })

  it('resolves node parents without treating an annotation ref as a node id', () => {
    expect(resolveMigrationParent(branch, 'main-1')).toBe('child-1')
    expect(resolveMigrationParent(anchor, 'main-1')).toBe('main-1')
    expect(resolveMigrationParent(main, 'main-1')).toBe('main-1')
  })

  it('uses module-scoped deterministic temporary ids', () => {
    const first = nextTempId()
    const second = nextTempId()
    expect(first).toMatch(/^tmp-\d+$/)
    expect(Number(second.slice(4))).toBe(Number(first.slice(4)) + 1)
  })
})

void ({} as RouteConvergence)
