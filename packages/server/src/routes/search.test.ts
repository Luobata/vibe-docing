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
  return { app: buildApp(deps), deps }
}

describe('search route', () => {
  it('finds notes by question and body text across trees with snippets', async () => {
    const { app, deps } = setup()
    const created = await app.inject({
      method: 'POST',
      payload: { title: '检索库' },
      url: '/api/trees',
    })
    const { tree, rootNode } = created.json<{ tree: { id: string }; rootNode: { id: string } }>()
    deps.nodes.updateGeneration(rootNode.id, {
      aiResponse: JSON.stringify({ content: [{ content: [{ text: 'Redis 缓存穿透的解法包括布隆过滤器', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
      status: 'complete',
      userInput: '如何设计缓存',
    })
    const other = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })

    const hitQuestion = await app.inject({ method: 'GET', url: '/api/search?q=%E7%BC%93%E5%AD%98' })
    expect(hitQuestion.statusCode).toBe(200)
    const byQuestion = hitQuestion.json<{ hits: Array<{ nodeId: string; treeId: string }> }>()
    expect(byQuestion.hits.map((hit) => hit.nodeId)).toContain(rootNode.id)

    const hitBody = await app.inject({ method: 'GET', url: '/api/search?q=%E5%B8%83%E9%9A%86%E8%BF%87%E6%BB%A4%E5%99%A8' })
    const byBody = hitBody.json<{ hits: Array<{ nodeId: string; snippet: string }> }>()
    expect(byBody.hits.some((hit) => hit.nodeId === rootNode.id && hit.snippet.includes('布隆过滤器'))).toBe(true)
    expect(byBody.hits.every((hit) => hit.nodeId !== other.id)).toBe(true)

    const tooShort = await app.inject({ method: 'GET', url: '/api/search?q=a' })
    expect(tooShort.json()).toEqual({ hits: [] })
    await app.close()
  })
})
