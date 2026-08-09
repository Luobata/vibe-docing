import fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { createApi } from './client'

describe('api client with Fastify', () => {
  it('sends DELETE and bodyless POST requests without empty-json 400s', async () => {
    const app = fastify({ logger: false })
    app.delete('/api/nodes/:id', async () => ({ ok: true }))
    app.delete('/api/trees/:id', async () => ({ ok: true }))
    app.post('/api/nodes/:id/restore', async () => ({ ok: true }))
    app.post<{ Params: { id: string } }>(
      '/api/nodes/:id/versions/:versionNo/revert',
      async (request) => ({ node: { id: request.params.id } }),
    )
    app.post('/api/nodes/:id/route', async () => ({ state: 'consistent' }))
    const statuses: number[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = init?.body
      const response = await app.inject({
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: (init?.method ?? 'GET') as 'DELETE' | 'POST',
        ...(body === undefined ? {} : { payload: String(body) }),
        url: String(input),
      })
      statuses.push(response.statusCode)
      return new Response(response.body, {
        headers: {
          'content-type':
            response.headers['content-type']?.toString() ?? 'application/json',
        },
        status: response.statusCode,
      })
    }
    const api = createApi({ fetchImpl })

    try {
      await expect(api.deleteNode('node-1')).resolves.toEqual({ ok: true })
      await expect(api.restoreNode('node-1')).resolves.toEqual({ ok: true })
      await expect(api.revert('node-1', 1)).resolves.toHaveProperty(
        'node.id',
        'node-1',
      )
      await expect(api.route('answer-1')).resolves.toHaveProperty(
        'state',
        'consistent',
      )
      await expect(api.deleteTree('tree-1')).resolves.toEqual({ ok: true })

      expect(statuses).toEqual([200, 200, 200, 200, 200])
    } finally {
      await app.close()
    }
  })
})
