import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { createMockProvider } from '../provider/mock-provider'
import { fixedClock } from '../util/clock'

function setup(chunks: string[] = ['A', 'B']) {
  const deps = createDeps({
    clock: fixedClock('2026-08-05T00:00:00.000Z'),
    db: openMemoryDb(),
  })
  deps.providerOverride = createMockProvider({ chunks })
  const { rootNode } = deps.trees.create('tree')
  return { app: buildApp(deps), deps, rootNode }
}

describe('answer SSE route', () => {
  it('streams chunks followed by the completed node', async () => {
    const { app, rootNode } = setup()
    const response = await app.inject({
      method: 'POST',
      payload: { userInput: '问题' },
      url: `/api/nodes/${rootNode.id}/answer`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(response.body).toContain('data: {"type":"chunk","text":"A"}')
    expect(response.body).toContain('data: {"type":"chunk","text":"B"}')
    expect(response.body).toContain('data: {"type":"done","node":')
    await app.close()
  })

  it('emits an SSE error event and preserves error state on interruption', async () => {
    const { app, deps, rootNode } = setup(['partial', 'lost'])
    deps.providerOverride = createMockProvider({ chunks: ['partial', 'lost'], failAfter: 1 })
    const response = await app.inject({
      method: 'POST', payload: { userInput: '问题' }, url: `/api/nodes/${rootNode.id}/answer`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"type":"error"')
    expect(deps.nodes.get(rootNode.id)?.status).toBe('error')
    await app.close()
  })

  it('returns JSON validation/not-found errors before opening SSE', async () => {
    const { app, rootNode } = setup()
    expect((await app.inject({
      method: 'POST', payload: { userInput: '' }, url: `/api/nodes/${rootNode.id}/answer`,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST', payload: { userInput: 'q' }, url: '/api/nodes/missing/answer',
    })).statusCode).toBe(404)
    await app.close()
  })
})
