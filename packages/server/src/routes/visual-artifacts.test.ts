import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

describe('visual artifact route', () => {
  it('returns an exact persisted revision and stable 400/404 errors', async () => {
    const deps = createDeps({ clock: fixedClock('2026-08-10T00:00:00.000Z'), db: openMemoryDb() })
    const artifact = deps.visualArtifacts.create({
      schemaVersion: 1, artifactId: 'diagram-1', revision: 1,
      kind: 'flow', title: 'Flow', altText: 'A to B', renderer: 'svg',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ id: 'e', source: 'a', target: 'b' }], groups: [],
    })
    const app = buildApp(deps)

    const found = await app.inject({ method: 'GET', url: '/api/visual-artifacts/diagram-1/1' })
    expect(found.statusCode).toBe(200)
    expect(found.json()).toEqual({ artifact })
    expect((await app.inject({ method: 'GET', url: '/api/visual-artifacts/diagram-1/nope' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/visual-artifacts/missing/1' })).statusCode).toBe(404)
    await app.close()
  })
})
