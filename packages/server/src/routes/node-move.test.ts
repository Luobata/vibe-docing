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

describe('node move route + share map', () => {
  it('moves a note file into a directory and reflects the new path', async () => {
    const { app, deps } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '目录库' }, url: '/api/trees' })
    const { rootNode } = created.json<{ rootNode: { id: string } }>()
    // 先物化文件（hydrate 会建默认路径）
    await app.inject({ method: 'GET', url: `/api/nodes/${rootNode.id}` })

    const moved = await app.inject({
      method: 'POST',
      payload: { directory: '工作/周报' },
      url: `/api/nodes/${rootNode.id}/move`,
    })
    expect(moved.statusCode).toBe(200)
    const node = moved.json<{ node: { file_path: string | null } }>().node
    expect(node.file_path).toContain('工作/周报/')

    const rejected = await app.inject({
      method: 'POST',
      payload: { directory: '../etc' },
      url: `/api/nodes/${rootNode.id}/move`,
    })
    expect(rejected.statusCode).toBe(200) // 清洗后为合法目录（.. 被剔除）
    const sanitized = rejected.json<{ node: { file_path: string | null } }>().node
    expect(sanitized.file_path).not.toContain('..')
    expect(deps.nodes.get(rootNode.id)?.file_path).toBeTruthy()
    await app.close()
  })

  it('renders a session map section in shared html for multi-node trees', async () => {
    const { app, deps } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '分享地图库' }, url: '/api/trees' })
    const { tree, rootNode } = created.json<{ tree: { id: string }; rootNode: { id: string } }>()
    deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })
    deps.nodes.create({ parentId: rootNode.id, treeId: tree.id })

    const share = await app.inject({ method: 'POST', url: `/api/nodes/${rootNode.id}/share` })
    const shareUrl = share.json<{ share: { url: string } }>().share.url
    const page = await app.inject({ method: 'GET', url: shareUrl })
    expect(page.statusCode).toBe(200)
    const html = page.body
    expect(html).toContain('share-map')
    expect(html).toContain('会话地图')
    expect(html).toContain('分享起点')
    await app.close()
  })
})

describe('node tags route', () => {
  it('sanitizes and persists editable tags', async () => {
    const { app, deps } = setup()
    const created = await app.inject({ method: 'POST', payload: { title: '标签库' }, url: '/api/trees' })
    const { rootNode } = created.json<{ rootNode: { id: string } }>()

    const updated = await app.inject({
      method: 'PUT',
      payload: { tags: ['  Redis  ', '', '缓存设计', 'x'.repeat(30), 'Redis'] },
      url: `/api/nodes/${rootNode.id}/tags`,
    })
    expect(updated.statusCode).toBe(200)
    const node = updated.json<{ node: { tags_json: string | null } }>().node
    expect(JSON.parse(node.tags_json ?? '[]')).toEqual(['Redis', '缓存设计', 'xxxxxxxxxxxxxxxx'])

    const invalid = await app.inject({ method: 'PUT', payload: { tags: 'nope' }, url: `/api/nodes/${rootNode.id}/tags` })
    expect(invalid.statusCode).toBe(400)
    expect(deps.nodes.get(rootNode.id)?.tags_json).toBeTruthy()
    await app.close()
  })
})
