import { plainTextToProseMirror } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'

describe('document sharing', () => {
  it('is idempotent, rotates after revoke, and serves the latest tree', async () => {
    const app = buildApp()
    const created = await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'Shared <Tree>' } })
    const { tree, rootNode } = created.json()
    app.deps.nodes.updateContent(rootNode.id, { userInput: plainTextToProseMirror('# question'), aiResponse: plainTextToProseMirror('first') })

    const first = (await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/share` })).json().share
    const repeated = (await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/share` })).json().share
    expect(repeated.url).toBe(first.url)
    expect((app.deps.db.prepare('SELECT COUNT(*) count FROM document_shares WHERE tree_id = ? AND is_enabled = 1').get(tree.id) as { count: number }).count).toBe(1)

    const html = await app.inject({ method: 'GET', url: first.url })
    expect(html.statusCode).toBe(200)
    expect(html.headers['cache-control']).toBe('no-store')
    expect(html.headers['x-robots-tag']).toBe('noindex,nofollow')
    expect(html.body).toContain('&lt;Tree&gt;')
    expect(html.body).toContain('rel="alternate"')
    expect(html.body).not.toContain(tree.id)

    app.deps.nodes.updateContent(rootNode.id, { aiResponse: plainTextToProseMirror('edited live') })
    const child = app.deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: plainTextToProseMirror('branch') })
    app.deps.nodes.updateContent(child.id, { aiResponse: plainTextToProseMirror('child answer') })
    const markdown = await app.inject({ method: 'GET', url: first.markdownUrl })
    expect(markdown.headers['content-type']).toContain('text/markdown')
    expect(markdown.body).toContain('edited live')
    expect(markdown.body).toContain('child answer')
    expect(markdown.body.match(/^# /gm)).toHaveLength(1)
    expect(markdown.body).not.toContain(rootNode.id)

    expect((await app.inject({ method: 'DELETE', url: `/api/trees/${tree.id}/share` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: first.url })).statusCode).toBe(404)
    const second = (await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/share` })).json().share
    expect(second.url).not.toBe(first.url)
    expect((await app.inject({ method: 'GET', url: '/share/not-a-token' })).statusCode).toBe(404)
    await app.close()
  })

  it('returns stable management error codes', async () => {
    const app = buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/trees/missing/share' })).json()).toEqual({ code: 'TREE_NOT_FOUND' })
    expect((await app.inject({ method: 'GET', url: '/api/nodes/missing/share' })).json()).toEqual({ code: 'NODE_NOT_FOUND' })
    const { tree } = (await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'x' } })).json()
    expect((await app.inject({ method: 'DELETE', url: `/api/trees/${tree.id}/share` })).json()).toEqual({ code: 'SHARE_NOT_FOUND' })
    await app.close()
  })

  it('creates distinct parent and child shares with node-scoped subtrees', async () => {
    const app = buildApp()
    const { tree, rootNode } = (await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'Node scoped' } })).json()
    app.deps.nodes.updateContent(rootNode.id, {
      userInput: plainTextToProseMirror('parent question'),
      aiResponse: plainTextToProseMirror('parent answer'),
    })
    const child = app.deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: plainTextToProseMirror('child question') })
    app.deps.nodes.updateContent(child.id, { aiResponse: plainTextToProseMirror('child answer') })
    const grandchild = app.deps.nodes.create({ treeId: tree.id, parentId: child.id, userInput: plainTextToProseMirror('grandchild question') })
    app.deps.nodes.updateContent(grandchild.id, { aiResponse: plainTextToProseMirror('grandchild answer') })
    const sibling = app.deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: plainTextToProseMirror('sibling question') })
    app.deps.nodes.updateContent(sibling.id, { aiResponse: plainTextToProseMirror('sibling answer') })

    const parentShare = (await app.inject({ method: 'POST', url: `/api/nodes/${rootNode.id}/share` })).json().share
    const childShare = (await app.inject({ method: 'POST', url: `/api/nodes/${child.id}/share` })).json().share
    const repeatedChildShare = (await app.inject({ method: 'POST', url: `/api/nodes/${child.id}/share` })).json().share

    expect(parentShare.nodeId).toBe(rootNode.id)
    expect(childShare.nodeId).toBe(child.id)
    expect(childShare.url).not.toBe(parentShare.url)
    expect(repeatedChildShare.url).toBe(childShare.url)
    expect((app.deps.db.prepare('SELECT COUNT(*) count FROM document_shares WHERE tree_id = ? AND is_enabled = 1').get(tree.id) as { count: number }).count).toBe(2)

    const parentMarkdown = await app.inject({ method: 'GET', url: parentShare.markdownUrl })
    expect(parentMarkdown.body).toContain('parent answer')
    expect(parentMarkdown.body).toContain('child answer')
    expect(parentMarkdown.body).toContain('grandchild answer')
    expect(parentMarkdown.body).toContain('sibling answer')

    const childMarkdown = await app.inject({ method: 'GET', url: childShare.markdownUrl })
    expect(childMarkdown.body).toContain('# Node scoped · child question')
    expect(childMarkdown.body).toContain('child answer')
    expect(childMarkdown.body).toContain('grandchild answer')
    expect(childMarkdown.body).not.toContain('parent answer')
    expect(childMarkdown.body).not.toContain('sibling answer')

    expect((await app.inject({ method: 'DELETE', url: `/api/nodes/${child.id}/share` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: childShare.url })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: parentShare.url })).statusCode).toBe(200)
    await app.close()
  })

  it('serves referenced canvas revisions as semantic Markdown and static HTML', async () => {
    const app = buildApp()
    const { tree, rootNode } = (await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'Canvas share' } })).json()
    const artifactId = 'private-canvas-id'
    const scene = {
      schemaVersion: 1 as const,
      kind: 'architecture' as const,
      title: 'Canvas 架构',
      altText: '客户端连接服务端',
      renderer: 'canvas' as const,
      nodes: [{ id: 'client', label: '客户端' }, { id: 'server', label: '服务端', description: '公开分享渲染' }],
      edges: [{ id: 'request', source: 'client', target: 'server', label: '请求' }],
      groups: [],
    }
    app.deps.visualArtifacts.create({ ...scene, artifactId, revision: 1 })
    const response = (revision: number, altText: string) => JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '架构说明' }] },
        { type: 'visual_ref', attrs: { artifactId, revision, altText } },
      ],
    })
    app.deps.nodes.updateContent(rootNode.id, { aiResponse: response(1, scene.altText) })
    const share = (await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/share` })).json().share

    const markdown = await app.inject({ method: 'GET', url: share.markdownUrl })
    expect(markdown.statusCode).toBe(200)
    expect(markdown.body).toContain('```visual-scene')
    expect(markdown.body).toContain('"title": "Canvas 架构"')
    expect(markdown.body).toContain('"description": "公开分享渲染"')
    expect(markdown.body).not.toContain(artifactId)

    const html = await app.inject({ method: 'GET', url: share.url })
    expect(html.statusCode).toBe(200)
    expect(html.body).toContain('<figure class="share-visual"')
    expect(html.body).toContain('<svg role="img"')
    expect(html.body).toContain('data-node-count="2"')
    expect(html.body).not.toContain(artifactId)

    app.deps.visualArtifacts.create({ ...scene, title: 'Canvas 架构 v2', artifactId, revision: 2 })
    app.deps.nodes.updateContent(rootNode.id, { aiResponse: response(2, scene.altText) })
    const latest = await app.inject({ method: 'GET', url: share.markdownUrl })
    expect(latest.body).toContain('"title": "Canvas 架构 v2"')
    expect(latest.body).not.toContain('"title": "Canvas 架构"')
    await app.close()
  })
})
