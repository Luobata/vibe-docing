import { describe, expect, it } from 'vitest'
import { parseJsonCanvas } from './json-canvas'

describe('parseJsonCanvas', () => {
  it('accepts standard nodes and preserves extension fields', () => {
    const source = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 120, text: '# A', pluginData: 1 }],
      edges: [],
      custom: true,
    })
    expect(parseJsonCanvas(source)).toMatchObject({ custom: true, nodes: [{ pluginData: 1 }] })
  })

  it('rejects edges pointing to missing nodes', () => {
    const source = JSON.stringify({ nodes: [], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] })
    expect(parseJsonCanvas(source)).toBeUndefined()
  })
})
