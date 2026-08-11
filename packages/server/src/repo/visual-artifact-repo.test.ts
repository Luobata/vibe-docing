import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createVisualArtifactRepo } from './visual-artifact-repo'

const artifact = (revision: number, title = `Flow ${revision}`) => ({
  schemaVersion: 1 as const,
  artifactId: 'artifact-1',
  revision,
  kind: 'flow' as const,
  title,
  altText: 'Start then finish',
  renderer: 'svg' as const,
  nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Finish' }],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
  groups: [],
})

describe('VisualArtifactRepo', () => {
  it('stores immutable revisions and resolves the latest revision', () => {
    const repo = createVisualArtifactRepo(openMemoryDb(), fixedClock('2026-08-10T00:00:00.000Z'))
    expect(repo.create(artifact(1))).toEqual(repo.create(artifact(1)))
    repo.create(artifact(2))

    expect(repo.get('artifact-1', 1)?.revision).toBe(1)
    expect(repo.getLatest('artifact-1')?.revision).toBe(2)
    expect(repo.get('missing', 1)).toBeUndefined()
  })

  it('rejects conflicting content for the same immutable revision', () => {
    const repo = createVisualArtifactRepo(openMemoryDb(), fixedClock('2026-08-10T00:00:00.000Z'))
    repo.create(artifact(1))
    expect(() => repo.create(artifact(1, 'Changed'))).toThrow(/different content/)
  })
})
