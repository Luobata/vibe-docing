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

describe('annotation route', () => {
  it('creates a note annotation without a child node', async () => {
    const { app, rootNode } = setup()
    const response = await app.inject({
      method: 'POST',
      payload: { anchorFrom: 0, anchorTo: 3, quotedText: '内存快', note: '待验证' },
      url: `/api/nodes/${rootNode.id}/annotation`,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.annotation.note).toBe('待验证')
    expect(body.annotation.child_node_id).toBeNull()
    await app.close()
  })

  it('rejects empty note', async () => {
    const { app, rootNode } = setup()
    const response = await app.inject({
      method: 'POST',
      payload: { anchorFrom: 0, anchorTo: 3, quotedText: '内存快', note: '   ' },
      url: `/api/nodes/${rootNode.id}/annotation`,
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })
})
