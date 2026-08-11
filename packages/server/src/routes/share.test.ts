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
    const { tree } = (await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'x' } })).json()
    expect((await app.inject({ method: 'DELETE', url: `/api/trees/${tree.id}/share` })).json()).toEqual({ code: 'SHARE_NOT_FOUND' })
    await app.close()
  })
})
