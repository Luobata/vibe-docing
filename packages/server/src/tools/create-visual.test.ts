import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { fixedClock } from '../util/clock'
import { createVisualArtifactFromTool } from './create-visual'

const valid = {
  kind: 'architecture',
  title: 'Runtime',
  altText: 'Client, runtime, and store',
  renderer: 'canvas',
  nodes: [{ id: 'client', label: 'Client' }, { id: 'runtime', label: 'Runtime' }, { id: 'store', label: 'Store' }],
  edges: [{ id: 'e1', source: 'client', target: 'runtime' }, { id: 'e2', source: 'runtime', target: 'store' }],
  groups: [],
}
const repo = () => createVisualArtifactRepo(openMemoryDb(), fixedClock('2026-08-10T00:00:00.000Z'))

describe('create_visual', () => {
  it('validates and persists renderer-neutral model input', () => {
    const artifacts = repo()
    const result = createVisualArtifactFromTool({
      argsJson: JSON.stringify(valid), artifactId: 'v1', revision: 1, artifacts,
    })
    expect(artifacts.get('v1', 1)).toEqual(result)
  })

  it.each([
    { ...valid, title: '<script>x</script>' },
    { ...valid, nodes: [{ id: 'x', label: 'x', onClick: 'run()' }] },
    { ...valid, nodes: [{ id: 'x', label: 'docs', data: { url: 'https://example.com' } }] },
  ])('rejects executable markup, handlers, and external URLs', (value) => {
    expect(() => createVisualArtifactFromTool({
      argsJson: JSON.stringify(value), artifactId: 'unsafe', revision: 1, artifacts: repo(),
    })).toThrow(/validation failed/)
  })
})
