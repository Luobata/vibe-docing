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
  const { rootNode, tree } = deps.trees.create('tree')
  const child = deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
  const grandchild = deps.nodes.create({ parentId: child.id, treeId: tree.id })
  return { app: buildApp(deps), child, deps, grandchild, rootNode, tree }
}

describe('trash routes', () => {
  it('soft-deletes/restores a subtree and lists deleted nodes', async () => {
    const { app, child, deps, grandchild, tree } = setup()
    expect((await app.inject({ method: 'DELETE', url: `/api/nodes/${child.id}` })).json())
      .toEqual({ ok: true })
    expect(deps.nodes.get(grandchild.id)?.is_deleted).toBe(1)

    const trash = await app.inject({ method: 'GET', url: `/api/trees/${tree.id}/trash` })
    expect(trash.json<{ nodes: Array<{ id: string }> }>().nodes.map((node) => node.id).sort())
      .toEqual([child.id, grandchild.id].sort())
    expect((await app.inject({ method: 'GET', url: `/api/nodes/${child.id}/path` })).statusCode)
      .toBe(404)

    expect((await app.inject({ method: 'POST', url: `/api/nodes/${child.id}/restore` })).json())
      .toEqual({ ok: true })
    expect(deps.nodes.get(grandchild.id)?.is_deleted).toBe(0)
    await app.close()
  })

  it('returns 404 for missing nodes and trees', async () => {
    const { app } = setup()
    expect((await app.inject({ method: 'DELETE', url: '/api/nodes/missing' })).statusCode)
      .toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/nodes/missing/restore' })).statusCode)
      .toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/trees/missing/trash' })).statusCode)
      .toBe(404)
    await app.close()
  })
})
