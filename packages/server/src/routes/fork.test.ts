import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-05T00:00:00.000Z'),
    db: openMemoryDb(),
  })
  const created = deps.trees.create('tree')
  return { app: buildApp(deps), deps, ...created }
}

describe('fork route', () => {
  it('forks an active parent from an annotation seed', async () => {
    const { app, rootNode, tree } = setup()
    const response = await app.inject({
      method: 'POST',
      payload: { kind: 'whole', seedText: '深入这个话题', treeId: tree.id },
      url: `/api/nodes/${rootNode.id}/fork`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      annotation: { child_node_id: expect.any(String) },
      childNode: { parent_id: rootNode.id },
    })
    await app.close()
  })

  it('rejects invalid payloads, missing parents, and tree mismatches', async () => {
    const { app, rootNode } = setup()
    expect((await app.inject({
      method: 'POST', payload: { kind: 'whole' }, url: `/api/nodes/${rootNode.id}/fork`,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST',
      payload: { kind: 'whole', seedText: 'seed', treeId: 'tree' },
      url: '/api/nodes/missing/fork',
    })).statusCode).toBe(404)
    expect((await app.inject({
      method: 'POST',
      payload: { kind: 'whole', seedText: 'seed', treeId: 'wrong-tree' },
      url: `/api/nodes/${rootNode.id}/fork`,
    })).statusCode).toBe(400)
    await app.close()
  })
})
