import { describe, expect, it } from 'vitest'
import type { AnnotationRow } from '@vibe/shared'
import { pickAnchorTarget } from './anchor-target'
const a = (o: Partial<AnnotationRow>): AnnotationRow => ({ id:'', node_id:'n', kind:'selection', anchor_from:0, anchor_to:10, quoted_text:null, note:null, child_node_id:null, created_at:'2026-01-01', ...o })

describe('pickAnchorTarget', () => {
  it('prefers a branch over a note in the overlapping set', () => {
    const anns = [a({ id:'note1', note:'n', anchor_from:0, anchor_to:10 }), a({ id:'fork1', child_node_id:'c1', anchor_from:2, anchor_to:6, created_at:'2026-01-02' })]
    expect(pickAnchorTarget(anns, 'note1')).toEqual({ kind:'branch', childNodeId:'c1' })
  })
  it('picks the earliest branch when several overlap', () => {
    const anns = [a({ id:'f2', child_node_id:'c2', created_at:'2026-01-03' }), a({ id:'f1', child_node_id:'c1', created_at:'2026-01-02' })]
    expect(pickAnchorTarget(anns, 'f2')).toEqual({ kind:'branch', childNodeId:'c1' })
  })
  it('returns a note target when only notes overlap', () => {
    const anns = [a({ id:'note1', note:'n' })]
    expect(pickAnchorTarget(anns, 'note1')).toEqual({ kind:'note', annotationId:'note1' })
  })
  it('returns null for an unknown id', () => {
    expect(pickAnchorTarget([], 'nope')).toBeNull()
  })
  it('skips a deleted branch in favor of a live note when isBranchLive is false', () => {
    const anns = [
      a({ id: 'note1', note: 'n', anchor_from: 0, anchor_to: 10 }),
      a({ id: 'fork1', child_node_id: 'gone', anchor_from: 2, anchor_to: 6, created_at: '2026-01-02' }),
    ]
    expect(pickAnchorTarget(anns, 'note1', (childId) => childId !== 'gone')).toEqual({ kind: 'note', annotationId: 'note1' })
  })
})
