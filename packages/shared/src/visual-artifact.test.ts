import { describe, expect, it } from 'vitest'
import { prosemirrorToPlainText, prosemirrorToRenderRuns, validateVisualArtifact, validateVisualReference, validateVisualScene, type VisualKind } from './index'

const scene = (kind: VisualKind = 'flow') => ({
  schemaVersion: 1 as const,
  kind,
  title: 'Request flow',
  altText: 'Client sends a request to API.',
  renderer: 'svg' as const,
  nodes: [{ id: 'client', label: 'Client' }, { id: 'api', label: 'API' }],
  edges: [{ id: 'request', source: 'client', target: 'api' }],
  groups: [],
})

describe('visual contracts', () => {
  it.each(['architecture', 'flow', 'sequence', 'mindmap', 'comparison'] as const)(
    'accepts a valid %s scene', (kind) => expect(validateVisualScene(scene(kind)).success).toBe(true),
  )

  it('validates artifact and stable reference revisions', () => {
    expect(validateVisualArtifact({ ...scene(), artifactId: 'visual-1', revision: 1 }).success).toBe(true)
    expect(validateVisualReference({ artifactId: 'visual-1', revision: 1, altText: 'Fallback' }).success).toBe(true)
    expect(validateVisualReference({ artifactId: 'visual-1', revision: 0, altText: 'Fallback' }).success).toBe(false)
  })

  it('rejects duplicate nodes, dangling edges, invalid groups, and limits', () => {
    const base = scene()
    expect(validateVisualScene({ ...base, nodes: [...base.nodes, { id: 'api', label: 'Again' }] }).success).toBe(false)
    expect(validateVisualScene({ ...base, edges: [{ id: 'x', source: 'client', target: 'missing' }] }).success).toBe(false)
    expect(validateVisualScene({ ...base, groups: [{ id: 'g', label: 'G', nodeIds: ['missing'] }] }).success).toBe(false)
    expect(validateVisualScene({ ...base, nodes: Array.from({ length: 61 }, (_, id) => ({ id: `${id}`, label: 'n' })), edges: [] }).success).toBe(false)
    expect(validateVisualScene({ ...base, edges: Array.from({ length: 121 }, (_, id) => ({ id: `${id}`, source: 'client', target: 'api' })) }).success).toBe(false)
  })

  it.each([
    { ...scene(), title: '<script>alert(1)</script>' },
    { ...scene(), nodes: [{ id: 'x', label: 'x', onClick: 'run()' }] },
    { ...scene(), nodes: [{ id: 'x', label: 'docs', data: { url: 'https://example.com' } }] },
    { ...scene(), altText: 'javascript:alert(1)' },
  ])('rejects scripts, HTML, handlers, and external links', (value) => {
    expect(validateVisualScene(value).success).toBe(false)
  })

  it('renders visual_ref altText while preserving legacy behavior', () => {
    const doc = JSON.stringify({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'visual_ref', attrs: { artifactId: 'visual-1', revision: 1, altText: 'Flow fallback' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ] })
    expect(prosemirrorToPlainText(doc)).toBe('Before\nFlow fallback\nAfter')
    expect(prosemirrorToRenderRuns(doc).map(({ start, end, type }) => ({ start, end, type }))).toEqual([
      { type: 'text', start: 0, end: 7 },
      { type: 'visual', start: 7, end: 21 },
      { type: 'text', start: 21, end: 26 },
    ])
    expect(prosemirrorToPlainText('legacy plain text')).toBe('legacy plain text')
    expect(prosemirrorToPlainText(null)).toBe('')
  })
})
