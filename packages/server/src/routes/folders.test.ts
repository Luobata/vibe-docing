import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

describe('folder routes', () => {
  const now = '2026-09-13T00:00:00.000Z'
  let app: ReturnType<typeof buildApp>
  let deps: ReturnType<typeof createDeps>

  beforeEach(() => {
    deps = createDeps({ clock: fixedClock(now), db: openMemoryDb() })
    app = buildApp(deps)
  })
  afterEach(async () => {
    await app.close()
    deps.db.close()
  })

  const create = (path: string) => app.inject({ method: 'POST', url: '/api/folders', payload: { path } })
  const remove = (path: string) => app.inject({ method: 'POST', url: '/api/folders/remove', payload: { path } })

  it('creates an empty folder with 201 without creating a tree', async () => {
    const response = await create('工作/后端')
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ folder: { path: '工作/后端', created_at: now } })
    expect(deps.trees.list()).toEqual([])
  })

  it('returns 200 with the original timestamp on repeated creation', async () => {
    const first = await create('工作')
    const second = await create(' 工作/ ')
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(deps.trees.listFolders()).toHaveLength(1)
  })

  it.each([
    ['../工作/../../后端', '工作/后端'],
    ['a/b/c/d/e/f/g', 'a/b/c/d/e/f'],
    ['项<>目/报:*?告', '项目/报告'],
  ])('shares path sanitization with tree moves for %j', async (input, expected) => {
    const { tree } = deps.trees.create('笔记库')
    const folder = await create(input)
    const moved = await app.inject({ method: 'PATCH', url: `/api/trees/${tree.id}`, payload: { folder: input } })
    expect(folder.statusCode).toBe(201)
    expect(folder.json()).toMatchObject({ folder: { path: expected } })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toMatchObject({ tree: { folder: expected } })
  })

  it('materializes a derived folder without moving its trees', async () => {
    const { tree } = deps.trees.create('笔记库')
    deps.trees.setFolder(tree.id, '工作')
    const before = deps.trees.get(tree.id)
    expect((await create('工作')).statusCode).toBe(201)
    expect(deps.trees.listFolders()).toEqual([{ path: '工作', created_at: now }])
    expect(deps.trees.get(tree.id)).toEqual(before)
  })

  it('lists only explicit folders sorted by path', async () => {
    const { tree } = deps.trees.create('派生')
    deps.trees.setFolder(tree.id, 'derived')
    await create('z/b')
    await create('a')
    const response = await app.inject({ method: 'GET', url: '/api/folders' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ folders: [
      { path: 'a', created_at: now }, { path: 'z/b', created_at: now },
    ] })
  })

  it('removes an empty folder using a sanitized slash path', async () => {
    await create('工作/后端')
    const response = await remove(' 工作/../后端 ')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(deps.trees.listFolders()).toEqual([])
  })

  it('rejects removal when an active tree occupies the exact folder', async () => {
    await create('工作')
    const { tree } = deps.trees.create('笔记库')
    deps.trees.setFolder(tree.id, '工作')
    const response = await remove('工作')
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'FOLDER_NOT_EMPTY' })
    expect(deps.trees.listFolders()).toHaveLength(1)
    expect(deps.trees.get(tree.id)?.folder).toBe('工作')
  })

  it('does not block removal for child folders or move their trees', async () => {
    await create('工作')
    await create('工作/空')
    const { tree } = deps.trees.create('笔记库')
    deps.trees.setFolder(tree.id, '工作/后端')
    expect((await remove('工作')).statusCode).toBe(200)
    expect(deps.trees.listFolders()).toEqual([{ path: '工作/空', created_at: now }])
    expect(deps.trees.get(tree.id)?.folder).toBe('工作/后端')
  })

  it('ignores deleted trees when removing a folder', async () => {
    await create('工作')
    const { tree } = deps.trees.create('已删除')
    deps.trees.setFolder(tree.id, '工作')
    deps.trees.softDelete(tree.id)
    expect((await remove('工作')).statusCode).toBe(200)
    expect(deps.trees.listDeleted()[0].folder).toBe('工作')
  })

  it('removes a missing record idempotently', async () => {
    expect((await remove('missing')).json()).toEqual({ ok: true })
    expect((await remove('missing')).statusCode).toBe(200)
  })

  it.each([{}, { path: 42 }, { path: '.././<>:*?' }])('rejects invalid paths in %j', async (payload) => {
    for (const url of ['/api/folders', '/api/folders/remove']) {
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400)
    }
    expect(deps.trees.listFolders()).toEqual([])
  })
})
