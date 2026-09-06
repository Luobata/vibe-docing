import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'

function setup(chunks = ['{"pairs":[{"quote":"旧","replacement":"新"}]}']) {
  const deps = createDeps({ db: openMemoryDb() })
  const { rootNode, tree } = deps.trees.create('纠正路由')
  const parent = deps.nodes.updateContent(rootNode.id, { contentSchemaVersion: 2, documentContent: '旧' })
  const source = deps.nodes.create({ parentId: parent.id, treeId: tree.id, userInput: '证据' })
  deps.nodes.updateContent(source.id, { contentSchemaVersion: 2, documentContent: '新证据' })
  deps.providerOverride = createMockProvider({ chunks })
  return { app: buildApp(deps), deps, parent, source }
}

describe('correct routes', () => {
  it('rejects blank directions before calling the provider or committing', async () => {
    const { app, deps, parent, source } = setup()

    const draft = await app.inject({
      method: 'POST', payload: { direction: '  ', mode: 'patch' }, url: `/api/nodes/${source.id}/correct`,
    })
    const commit = await app.inject({
      method: 'POST', payload: { direction: '', documentContent: '新' }, url: `/api/nodes/${source.id}/correct/commit`,
    })

    expect(draft.statusCode).toBe(400)
    expect(commit.statusCode).toBe(400)
    expect(deps.nodes.get(parent.id)?.document_content).toBe('旧')
    expect(deps.versions.listByNode(parent.id)).toHaveLength(0)
    await app.close()
  })

  it('rejects oversized directions before calling the provider', async () => {
    const { app, deps, source } = setup()
    const complete = vi.spyOn(deps.providerOverride!, 'complete')

    for (const mode of ['patch', 'append', 'rewrite'] as const) {
      const response = await app.inject({
        method: 'POST',
        payload: { direction: 'x'.repeat(2_001), mode },
        url: `/api/nodes/${source.id}/correct`,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'direction too long' })
    }
    expect(complete).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns a structured 503 for an unsupported provider', async () => {
    const { app, deps, source } = setup()
    deps.providerOverride = undefined
    deps.settings.set('provider.name', 'claude-o50')

    const response = await app.inject({
      method: 'POST',
      payload: { direction: '提炼要点', mode: 'append' },
      url: `/api/nodes/${source.id}/correct`,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      code: 'PROVIDER_CONFIG',
      error: 'Unsupported provider: claude-o50',
    })
    await app.close()
  })

  it('returns an append draft and commits the client-assembled section as a correction', async () => {
    const { app, deps, parent, source } = setup([
      '{"section":{"title":"补充建议","body":"先验证，再推广。"}}',
    ])

    const draft = await app.inject({
      method: 'POST',
      payload: { direction: '提炼分支要点补充', includeSubtree: true, mode: 'append' },
      url: `/api/nodes/${source.id}/correct`,
    })
    expect(draft.statusCode).toBe(200)
    expect(draft.json()).toEqual({
      mode: 'append',
      section: { body: '先验证，再推广。', title: '补充建议' },
    })
    expect(deps.nodes.get(parent.id)?.document_content).toBe('旧')

    const documentContent = '旧\n\n## 补充建议\n\n先验证，再推广。'
    const commit = await app.inject({
      method: 'POST',
      payload: { direction: '提炼分支要点补充', documentContent },
      url: `/api/nodes/${source.id}/correct/commit`,
    })
    expect(commit.statusCode).toBe(200)
    expect(deps.nodes.get(parent.id)?.document_content).toBe(documentContent)
    expect(deps.versions.listByNode(parent.id).map((version) => version.document_content)).toEqual([
      '旧',
      documentContent,
    ])
    expect(deps.merges.listByTarget(parent.id)).toEqual([
      expect.objectContaining({
        direction: '提炼分支要点补充', kind: 'correction', landing_segment_id: null,
      }),
    ])
    await app.close()
  })

  it('rejects empty, blank, and oversized commit content without database writes', async () => {
    const { app, deps, parent, source } = setup()

    const invalidContents = [
      { documentContent: '', error: 'invalid correction commit body' },
      { documentContent: '   ', error: 'invalid correction commit body' },
      { documentContent: 'x'.repeat(2_000_001), error: 'document content too long' },
    ]
    for (const { documentContent, error } of invalidContents) {
      const response = await app.inject({
        method: 'POST',
        payload: { direction: '纠正方向', documentContent },
        url: `/api/nodes/${source.id}/correct/commit`,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error })
    }
    expect(deps.nodes.get(parent.id)).toEqual(parent)
    expect(deps.versions.listByNode(parent.id)).toHaveLength(0)
    expect(deps.merges.listByTarget(parent.id)).toHaveLength(0)
    await app.close()
  })

  it('returns a patch draft without writes, then commits the final client document', async () => {
    const { app, deps, parent, source } = setup()

    const draft = await app.inject({
      method: 'POST',
      payload: { direction: '采用新证据', includeSubtree: true, mode: 'patch' },
      url: `/api/nodes/${source.id}/correct`,
    })
    expect(draft.statusCode).toBe(200)
    expect(draft.json()).toEqual({
      mode: 'patch',
      pairs: [{ quote: '旧', replacement: '新' }],
      unmatched: { heading: '纠正附注', strategy: 'append-note' },
    })
    expect(deps.nodes.get(parent.id)?.document_content).toBe('旧')

    const commit = await app.inject({
      method: 'POST',
      payload: { direction: '采用新证据', documentContent: '新\n\n保留内容' },
      url: `/api/nodes/${source.id}/correct/commit`,
    })
    expect(commit.statusCode).toBe(200)
    expect(commit.json().node.document_content).toBe('新\n\n保留内容')
    expect(commit.json().merge).toMatchObject({ kind: 'correction', direction: '采用新证据', landing_segment_id: null })
    const tree = await app.inject({ method: 'GET', url: `/api/trees/${parent.tree_id}` })
    expect(tree.json().merges).toEqual([
      expect.objectContaining({ kind: 'correction', direction: '采用新证据', landing_segment_id: null }),
    ])
    await app.close()
  })

  it('returns rewrite drafts and direct-parent errors with stable statuses', async () => {
    const { app, source } = setup(['{"fullText":"完整新正文"}'])
    const rewrite = await app.inject({
      method: 'POST', payload: { direction: '重写', mode: 'rewrite' }, url: `/api/nodes/${source.id}/correct`,
    })
    const missing = await app.inject({
      method: 'POST', payload: { direction: '重写', mode: 'rewrite' }, url: '/api/nodes/missing/correct',
    })

    expect(rewrite.statusCode).toBe(200)
    expect(rewrite.json()).toEqual({ fullText: '完整新正文', mode: 'rewrite' })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })
})
