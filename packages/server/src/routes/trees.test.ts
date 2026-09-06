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

describe('tree and node routes', () => {
  it('creates/lists/reads a tree and returns node detail and root path', async () => {
    const { app, deps } = setup()
    const created = await app.inject({
      method: 'POST',
      payload: { title: '缓存设计' },
      url: '/api/trees',
    })
    expect(created.statusCode).toBe(200)
    const { tree, rootNode } = created.json<{
      tree: { id: string; title: string }
      rootNode: { id: string }
    }>()
    const child = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id })

    expect((await app.inject({ method: 'GET', url: '/api/trees' })).json()).toMatchObject({
      trees: [{ id: tree.id, title: '缓存设计' }],
    })
    const treeResult = await app.inject({ method: 'GET', url: `/api/trees/${tree.id}` })
    expect(treeResult.json<{ nodes: Array<{ id: string }> }>().nodes.map((node) => node.id))
      .toEqual([rootNode.id, child.id])

    const nodeResult = await app.inject({ method: 'GET', url: `/api/nodes/${child.id}` })
    expect(nodeResult.json()).toMatchObject({ node: { id: child.id }, annotations: [], segments: [] })

    const path = await app.inject({ method: 'GET', url: `/api/nodes/${child.id}/path` })
    expect(path.json<{ path: Array<{ id: string }> }>().path.map((node) => node.id))
      .toEqual([rootNode.id, child.id])
    await app.close()
  })

  it('returns validation and not-found errors', async () => {
    const { app } = setup()
    const invalid = await app.inject({
      method: 'POST',
      payload: { title: '' },
      url: '/api/trees',
    })
    expect(invalid.statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/trees/missing' })).statusCode)
      .toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/nodes/missing' })).statusCode)
      .toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/nodes/missing/path' })).statusCode)
      .toBe(404)
    await app.close()
  })

  it('soft-deletes a tree so it drops out of the list and 404s', async () => {
    const { app } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '待删' }, url: '/api/trees' })
    const { tree } = created.json<{ tree: { id: string } }>()

    const del = await app.inject({ method: 'DELETE', url: `/api/trees/${tree.id}` })
    expect(del.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/trees' })).json<{ trees: unknown[] }>().trees)
      .toHaveLength(0)
    expect((await app.inject({ method: 'GET', url: `/api/trees/${tree.id}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/trees/missing' })).statusCode).toBe(404)
    await app.close()
  })

  it('lists and restores a deleted tree and rejects missing or active trees', async () => {
    const { app } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '待恢复' }, url: '/api/trees' })
    const { tree } = created.json<{ tree: { id: string } }>()
    await app.inject({ method: 'DELETE', url: `/api/trees/${tree.id}` })

    const deleted = await app.inject({ method: 'GET', url: '/api/trees/deleted' })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({ trees: [{ id: tree.id, is_deleted: 1 }] })

    const restored = await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/restore` })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({ tree: { id: tree.id, is_deleted: 0 } })
    expect((await app.inject({ method: 'GET', url: '/api/trees' })).json())
      .toMatchObject({ trees: [{ id: tree.id }] })
    expect((await app.inject({ method: 'GET', url: '/api/trees/deleted' })).json())
      .toEqual({ trees: [] })
    expect((await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/restore` })).statusCode)
      .toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/trees/missing/restore' })).statusCode)
      .toBe(404)
    await app.close()
  })

  it('renames a tree and rejects an empty title', async () => {
    const { app } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '旧' }, url: '/api/trees' })
    const { tree } = created.json<{ tree: { id: string } }>()

    const renamed = await app.inject({ method: 'PATCH', payload: { title: '新标题' }, url: `/api/trees/${tree.id}` })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<{ tree: { title: string } }>().tree.title).toBe('新标题')
    expect((await app.inject({ method: 'GET', url: `/api/trees/${tree.id}` })).json<{ tree: { title: string } }>().tree.title)
      .toBe('新标题')

    expect((await app.inject({ method: 'PATCH', payload: { title: '  ' }, url: `/api/trees/${tree.id}` })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PATCH', payload: { title: 'x' }, url: '/api/trees/missing' })).statusCode).toBe(404)
    await app.close()
  })
})

describe('tree folder', () => {
  it('assigns a tree to a sanitized folder and back to ungrouped', async () => {
    const { app } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '文件夹测试' }, url: '/api/trees' })
    const { tree } = created.json<{ tree: { id: string } }>()

    const moved = await app.inject({
      method: 'PATCH',
      payload: { folder: ' 工作/../周报 ' },
      url: `/api/trees/${tree.id}`,
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json<{ tree: { folder: string | null } }>().tree.folder).toBe('工作/周报')

    const back = await app.inject({
      method: 'PATCH',
      payload: { folder: null },
      url: `/api/trees/${tree.id}`,
    })
    expect(back.json<{ tree: { folder: string | null } }>().tree.folder).toBeNull()
    await app.close()
  })
})
