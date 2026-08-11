import { describe, expect, it } from 'vitest'
import { buildPublicShareSnapshot, validatePublicShareSnapshot } from './share-schema'

describe('public share schema', () => {
  it('builds and validates versioned snapshots with explicitly derived canvas layout', () => {
    const value = buildPublicShareSnapshot({
      share: { scope: 'tree', title: 'Example', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
      nodes: [{ index: 0, depth: 0, parentIndex: null, title: 'Root', inputText: '', responseText: '', visualRefs: [{ index: 0, altText: 'flow' }], status: 'complete' }],
      relations: { derivations: [] },
      annotations: [],
      artifacts: [{ schemaVersion: 1, kind: 'flow', title: 'Flow', altText: 'flow', renderer: 'canvas', nodes: [{ id: 'a', label: 'A' }], edges: [], groups: [] }],
    })
    expect(value.schemaVersion).toBe(1)
    expect(value.artifacts[0].derivedLayout.nodes[0].rect).toMatchObject({ x: 40, y: 40 })
    expect(validatePublicShareSnapshot(value)).toEqual({ success: true, value })
    expect(validatePublicShareSnapshot({ ...value, schemaVersion: 2 }).success).toBe(false)
  })
})
