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

  it('streams visual placeholder then ready with matching identifiers', async () => {
    const { app, deps, rootNode } = setup()
    deps.providerOverride = createMockProvider({ toolScript: [
      [{ type: 'tool_call', id: 'visual', name: 'create_visual', arguments: JSON.stringify({
        kind: 'sequence', title: 'Sequence', altText: 'Client calls API', renderer: 'canvas',
        nodes: [{ id: 'client', label: 'Client' }, { id: 'api', label: 'API' }],
        edges: [{ id: 'call', source: 'client', target: 'api' }], groups: [],
      }) }],
      [{ type: 'text', text: 'Fallback description.' }],
    ] })
    const response = await app.inject({
      method: 'POST', payload: { userInput: '画时序图' }, url: `/api/nodes/${rootNode.id}/answer`,
    })
    const events = response.body.trim().split('\n\n').map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
    expect(events.map((event) => event.type)).toEqual(['visual_placeholder', 'visual_ready', 'chunk', 'done'])
    expect(events[0]).toMatchObject({
      placeholderId: events[1].placeholderId,
      artifactId: events[1].artifactId,
      revision: 1,
    })
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

  it('returns a structured JSON 503 before opening SSE for an unsupported provider', async () => {
    const { app, deps, rootNode } = setup()
    deps.providerOverride = undefined
    deps.settings.set('provider.name', 'claude-o50')

    const response = await app.inject({
      method: 'POST',
      payload: { userInput: '问题' },
      url: `/api/nodes/${rootNode.id}/answer`,
    })

    expect(response.statusCode).toBe(503)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.json()).toEqual({
      code: 'PROVIDER_CONFIG',
      error: 'Unsupported provider: claude-o50',
    })
    await app.close()
  })
})
