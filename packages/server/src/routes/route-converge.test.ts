import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'

describe('POST /api/nodes/:id/route', () => {
  it('classifies an optimistic answer with an injected provider', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const answer = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: '继续',
    })
    deps.providerOverride = createMockProvider({
      chunks: [
        JSON.stringify({
          candidates: [
            { label: '主文档', refId: null, score: 0.95, target: 'main-continuation' },
            { label: '新分支', refId: 'a1', score: 0.2, target: 'new-branch' },
          ],
        }),
      ],
    })
    const app = buildApp(deps)

    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${answer.id}/route`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().state).toBe('consistent')
    await app.close()
  })

  it('returns 404 for a missing optimistic answer', async () => {
    const app = buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/nodes/missing/route',
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('returns 400 when the node is not an optimistic continuation', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode } = deps.trees.create('t')
    const app = buildApp(deps)

    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${rootNode.id}/route`,
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })
})
