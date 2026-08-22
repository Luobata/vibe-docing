import { describe, expect, it } from 'vitest'
import { documentContentOf, NODE_STATUSES, ROUTE_TARGETS, SEGMENT_TYPES } from './index'
import { prosemirrorToPlainText } from './prosemirror'

describe('shared type constants', () => {
  it('exposes all node statuses', () => {
    expect(NODE_STATUSES).toEqual([
      'draft',
      'streaming',
      'complete',
      'cancelled',
      'error',
    ])
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

describe('semantic document projection', () => {
  it('prefers canonical document content and only falls back for legacy rows', () => {
    expect(documentContentOf({ ai_response: 'generated', document_content: 'edited' })).toBe('edited')
    expect(documentContentOf({ ai_response: 'legacy', document_content: null })).toBe('legacy')
  })

  it('preserves block and list boundaries', () => {
    expect(prosemirrorToPlainText(JSON.stringify({
      content: [
        { content: [{ text: 'Title', type: 'text' }], type: 'heading' },
        {
          content: [
            { content: [{ content: [{ text: 'one', type: 'text' }], type: 'paragraph' }], type: 'list_item' },
            { content: [{ content: [{ text: 'two', type: 'text' }], type: 'paragraph' }], type: 'list_item' },
          ],
          type: 'bullet_list',
        },
      ],
      type: 'doc',
    }))).toBe('Title\none\ntwo')
  })
})
