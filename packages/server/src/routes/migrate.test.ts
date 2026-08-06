import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'

describe('POST /api/nodes/:id/migrate', () => {
  it('migrates an active node and returns the new path', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const target = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const answer = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const app = buildApp(deps)

    const response = await app.inject({
      method: 'POST',
      payload: { newParentId: target.id, seedText: '深入', target: 'new-branch' },
      url: `/api/nodes/${answer.id}/migrate`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().node.parent_id).toBe(target.id)
    expect(response.json().path.map((node: { id: string }) => node.id)).toEqual([
      rootNode.id,
      target.id,
      answer.id,
    ])
    await app.close()
  })

  it('returns 404 for a missing target and 400 for an invalid body', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode } = deps.trees.create('t')
    const app = buildApp(deps)

    const missing = await app.inject({
      method: 'POST',
      payload: { newParentId: 'missing', target: 'main-continuation' },
      url: `/api/nodes/${rootNode.id}/migrate`,
    })
    const invalid = await app.inject({
      method: 'POST',
      payload: { newParentId: rootNode.id, target: 'somewhere' },
      url: `/api/nodes/${rootNode.id}/migrate`,
    })

    expect(missing.statusCode).toBe(404)
    expect(invalid.statusCode).toBe(400)
    await app.close()
  })
})
