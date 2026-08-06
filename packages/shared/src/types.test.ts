import { describe, expect, it } from 'vitest'
import { NODE_STATUSES, ROUTE_TARGETS, SEGMENT_TYPES } from './index'

describe('shared type constants', () => {
  it('exposes all node statuses', () => {
    expect(NODE_STATUSES).toEqual(['draft', 'streaming', 'complete', 'error'])
  })

  it('exposes all segment types', () => {
    expect(SEGMENT_TYPES).toEqual([
      'ancestor-full',
      'ancestor-summary',
      'annotation-seed',
      'merged-conclusion',
    ])
  })

  it('exposes all route targets', () => {
    expect(ROUTE_TARGETS).toEqual([
      'main-continuation',
      'bound-subdoc',
      'new-branch',
    ])
  })
})
