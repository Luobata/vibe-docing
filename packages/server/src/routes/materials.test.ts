import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-materials-'))
  let now = '2026-09-14T00:00:00Z'
  const deps = createDeps({ db: openMemoryDb(), env: {}, vaultPath: root, clock: { now: () => now } })
  const { tree } = deps.trees.create('Materials')
  const app = buildApp(deps)
  cleanups.push(async () => { await app.close(); deps.db.close(); rmSync(root, { recursive: true, force: true }) })
  const create = (content: string, title?: string) => app.inject({ method: 'POST', url: `/api/trees/${tree.id}/materials`, payload: { content, title } })
  return { deps, app, tree, create, tick: () => { now = '2026-09-14T01:00:00Z' } }
}

describe('materials routes and repository', () => {
  it('creates, lists, edits in place, filters enabled rows and hard deletes without touching node versions', async () => {
    const { deps, app, tree, create, tick } = setup()
    const nodes = deps.db.prepare('SELECT * FROM nodes').all()
    const response = await create('  Original\ncontent  ', 'Source')
    expect(response.statusCode).toBe(201)
    const original = response.json().material
    expect(original).toMatchObject({ tree_id: tree.id, title: 'Source', content: '  Original\ncontent  ', enabled: 1 })
    expect((await app.inject({ method: 'GET', url: `/api/trees/${tree.id}/materials` })).json()).toEqual({ materials: [original] })
    tick()
    const edit = await app.inject({ method: 'PATCH', url: `/api/materials/${original.id}`, payload: { title: 'Edited', content: 'Updated body', enabled: false } })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().material).toMatchObject({ id: original.id, title: 'Edited', content: 'Updated body', enabled: 0,
      created_at: original.created_at, updated_at: '2026-09-14T01:00:00Z', content_hash: createHash('sha256').update('Updated body').digest('hex') })
    expect(deps.materials.listByTree(tree.id)).toHaveLength(1)
    expect(deps.materials.listByTree(tree.id, true)).toEqual([])
    expect((await app.inject({ method: 'PATCH', url: `/api/materials/${original.id}`, payload: { enabled: 1 } })).json().material.enabled).toBe(1)
    expect(deps.materials.listByTree(tree.id, true)).toHaveLength(1)
    expect((await app.inject({ method: 'DELETE', url: `/api/materials/${original.id}` })).json()).toEqual({ ok: true })
    expect(deps.materials.get(original.id)).toBeUndefined()
    expect(deps.db.prepare('SELECT * FROM nodes').all()).toEqual(nodes)
    expect(deps.db.prepare('SELECT COUNT(*) AS count FROM node_versions').get()).toEqual({ count: 0 })
    expect(deps.db.prepare('SELECT COUNT(*) AS count FROM document_shares').get()).toEqual({ count: 0 })
  })

  it('derives a missing or blank title from the first line, capped at 40 characters without truncating content', async () => {
    const { create } = setup()
    const content = '首'.repeat(60) + '\n第二行'
    expect((await create(content)).json().material).toMatchObject({ title: '首'.repeat(40), content })
    expect((await create('Another first line\nbody', '  ')).json().material.title).toBe('Another first line')
  })

  it('deduplicates identical content only within its tree and preserves the existing row on repeat POST', async () => {
    const { deps, app, tree, create, tick } = setup()
    const first = (await create('Same body', 'First')).json().material
    deps.materials.update(first.id, { enabled: false })
    const existing = deps.materials.get(first.id)
    tick()
    const duplicate = await create('Same body', 'Other title')
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json().material).toEqual(existing)
    expect(deps.materials.listByTree(tree.id)).toHaveLength(1)
    const other = deps.trees.create('Other').tree
    expect((await app.inject({ method: 'POST', url: `/api/trees/${other.id}/materials`, payload: { content: 'Same body' } })).statusCode).toBe(201)
  })

  it('rejects a content edit that would collide with another material, preserving both rows', async () => {
    const { app, deps, tree, create } = setup()
    const one = (await create('One')).json().material
    await create('Two')
    const before = deps.materials.listByTree(tree.id)
    const response = await app.inject({ method: 'PATCH', url: `/api/materials/${one.id}`, payload: { content: 'Two', enabled: false } })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('MATERIAL_ALREADY_EXISTS')
    expect(deps.materials.listByTree(tree.id)).toEqual(before)
  })

  it('accepts exactly 10k characters and rejects oversized creates and edits without truncation', async () => {
    const { deps, app, tree, create } = setup()
    const first = (await create('字'.repeat(10_000))).json().material
    expect(first.content).toHaveLength(10_000)
    for (const response of [await create('字'.repeat(10_001)), await app.inject({ method: 'PATCH', url: `/api/materials/${first.id}`, payload: { content: 'x'.repeat(10_001) } })]) {
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ code: 'MATERIAL_TOO_LARGE', error: expect.stringContaining('10,000') })
    }
    expect(deps.materials.listByTree(tree.id)).toEqual([first])
  })

  it('enforces the 20-row cap including disabled materials, but allows duplicate POST and an in-place edit at capacity', async () => {
    const { deps, app, tree, create } = setup()
    for (let index = 0; index < 20; index++) await create(`Material ${index}`)
    const first = deps.materials.listByTree(tree.id)[0]
    deps.materials.update(first.id, { enabled: false })
    const response = await create('Overflow')
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('TREE_MATERIAL_LIMIT')
    expect((await create(first.content)).statusCode).toBe(200)
    expect((await app.inject({ method: 'PATCH', url: `/api/materials/${first.id}`, payload: { content: 'Replacement' } })).statusCode).toBe(200)
    expect(deps.materials.listByTree(tree.id)).toHaveLength(20)
  })

  it('enforces the 50k total on creates and edits and releases quota when content shrinks or is deleted', async () => {
    const { deps, app, tree, create } = setup()
    for (let index = 0; index < 5; index++) expect((await create(String(index).repeat(10_000))).statusCode).toBe(201)
    const first = deps.materials.listByTree(tree.id)[0]
    expect((await create('Extra')).json().code).toBe('TREE_MATERIAL_LIMIT')
    await app.inject({ method: 'PATCH', url: `/api/materials/${first.id}`, payload: { content: 'short' } })
    const extra = (await create('x'.repeat(9_995))).json().material
    const tooLong = await app.inject({ method: 'PATCH', url: `/api/materials/${first.id}`, payload: { content: 'longer' } })
    expect(tooLong.statusCode).toBe(400)
    expect(tooLong.json().code).toBe('TREE_MATERIAL_LIMIT')
    expect(deps.materials.get(first.id)?.content).toBe('short')
    await app.inject({ method: 'DELETE', url: `/api/materials/${extra.id}` })
    expect((await create('Next')).statusCode).toBe(201)
  })

  it('rejects invalid input and missing resources without writing any material', async () => {
    const { app, deps, tree, create } = setup()
    for (const payload of [{}, { content: 1 }, { content: '' }, { content: '  ' }, { content: 'valid', title: 2 }]) {
      expect((await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/materials`, payload })).statusCode).toBe(400)
    }
    expect(deps.materials.listByTree(tree.id)).toEqual([])
    const item = (await create('Valid')).json().material
    for (const payload of [{}, { title: 3 }, { content: null }, { enabled: 'false' }]) {
      expect((await app.inject({ method: 'PATCH', url: `/api/materials/${item.id}`, payload })).statusCode).toBe(400)
    }
    for (const method of ['GET', 'POST'] as const) expect((await app.inject({ method, url: '/api/trees/missing/materials', ...(method === 'POST' ? { payload: { content: 'Valid' } } : {}) })).statusCode).toBe(404)
    for (const method of ['PATCH', 'DELETE'] as const) expect((await app.inject({ method, url: '/api/materials/missing', ...(method === 'PATCH' ? { payload: { enabled: true } } : {}) })).statusCode).toBe(404)
    expect(deps.materials.listByTree(tree.id)).toEqual([item])
  })
})
