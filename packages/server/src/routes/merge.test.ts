import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'

describe('POST /api/nodes/:id/merge', () => {
  it('merges a source node into its parent through the single endpoint', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    deps.providerOverride = createMockProvider({ chunks: ['结论'] })
    const app = buildApp(deps)

    const response = await app.inject({
      method: 'POST',
      payload: { targetNodeId: rootNode.id },
      url: `/api/nodes/${child.id}/merge`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().merge.source_node_id).toBe(child.id)
    expect(response.json().segment.content).toBe('结论')
    await app.close()
  })

  it('returns 404 for missing nodes and 400 for an invalid target', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    const unrelated = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    deps.providerOverride = createMockProvider({ chunks: ['结论'] })
    const app = buildApp(deps)

    const missing = await app.inject({
      method: 'POST',
      payload: { targetNodeId: rootNode.id },
      url: '/api/nodes/missing/merge',
    })
    const invalid = await app.inject({
      method: 'POST',
      payload: { targetNodeId: unrelated.id },
      url: `/api/nodes/${child.id}/merge`,
    })

    expect(missing.statusCode).toBe(404)
    expect(invalid.statusCode).toBe(400)
    expect(deps.merges.listByTarget(unrelated.id)).toHaveLength(0)
    await app.close()
  })

  it('returns a structured 409 when the source was already merged into the target', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    deps.providerOverride = createMockProvider({ chunks: ['结论'] })
    const app = buildApp(deps)
    const request = {
      method: 'POST' as const,
      payload: { targetNodeId: rootNode.id },
      url: `/api/nodes/${child.id}/merge`,
    }

    expect((await app.inject(request)).statusCode).toBe(200)
    const duplicate = await app.inject(request)

    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toEqual({
      code: 'MERGE_ALREADY_EXISTS',
      error: 'source node is already merged into target',
    })
    expect(deps.merges.listByTarget(rootNode.id)).toHaveLength(1)
    expect(deps.segments.listByNode(rootNode.id).filter((segment) => segment.type === 'merged-conclusion')).toHaveLength(1)
    await app.close()
  })

  it('returns a structured 503 for an unsupported provider', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    deps.settings.set('provider.name', 'claude-o50')
    const app = buildApp(deps)

    const response = await app.inject({
      method: 'POST',
      payload: { targetNodeId: rootNode.id },
      url: `/api/nodes/${child.id}/merge`,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      code: 'PROVIDER_CONFIG',
      error: 'Unsupported provider: claude-o50',
    })
    await app.close()
  })
})
