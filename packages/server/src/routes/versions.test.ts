import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { documentContentOf } from '@vibe/shared'
import { plainTextToProseMirror, prosemirrorToPlainText } from '../context/prosemirror'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-05T00:00:00.000Z'),
    db: openMemoryDb(),
  })
  const { rootNode } = deps.trees.create('tree')
  for (const answer of ['a\nb\nc', 'a\nx\nc']) {
    const aiResponse = plainTextToProseMirror(answer)
    deps.nodes.updateGeneration(rootNode.id, { aiResponse, status: 'complete' })
    deps.versions.snapshot({
      aiResponse,
      documentContent: aiResponse,
      changeKind: 'edit',
      nodeId: rootNode.id,
      userInput: null,
    })
  }
  return { app: buildApp(deps), deps, rootNode }
}

describe('version routes', () => {
  it.each(['legacy', 'native', 'canvas', 'base'])('restores %s content to its existing vault file and hash', async (kind) => {
    const { app, deps, rootNode } = setup()
    const fileKind = kind === 'canvas' || kind === 'base' ? kind : 'markdown'
    const source = kind === 'legacy' ? 'a\n\nb\n\nc'
      : kind === 'canvas' ? '{"nodes":[],"edges":[]}'
      : kind === 'base' ? 'views: []\n' : '# Native\n\n> Keep formatting\n'
    let versionNo = 1
    if (kind !== 'legacy') {
      versionNo = deps.versions.snapshot({
        aiResponse: null, documentContent: source, changeKind: 'edit', nodeId: rootNode.id, userInput: null,
      }).version_no
    }
    const empty = deps.nodes.updateContent(rootNode.id, { contentSchemaVersion: 2, documentContent: '' })
    deps.vault.writeNode(empty, '', fileKind)
    try {
      const response = await app.inject({ method: 'POST', url: `/api/nodes/${rootNode.id}/versions/${versionNo}/revert` })
      expect(response.statusCode).toBe(200)
      const restored = deps.nodes.get(rootNode.id)!
      expect(readFileSync(join(restored.vault_root!, restored.file_path!), 'utf8')).toBe(source)
      expect(restored.content_hash).toBe(createHash('sha256').update(source).digest('hex'))
      expect(response.json().node).toEqual(restored)
      const read = await app.inject({ method: 'GET', url: `/api/nodes/${rootNode.id}` })
      expect(read.json().node).toEqual(restored)
    } finally {
      await app.close()
      rmSync(deps.vault.root(), { recursive: true, force: true })
      deps.db.close()
    }
  })

  it('lists, diffs, and reverts by appending a new edit version', async () => {
    const { app, deps, rootNode } = setup()
    const list = await app.inject({ method: 'GET', url: `/api/nodes/${rootNode.id}/versions` })
    expect(list.json<{ versions: unknown[] }>().versions).toHaveLength(2)

    const diff = await app.inject({
      method: 'GET', url: `/api/nodes/${rootNode.id}/versions/1/diff/2`,
    })
    expect(diff.json()).toMatchObject({
      diff: [
        { text: 'a', type: 'same' },
        { text: 'b', type: 'del' },
        { text: 'x', type: 'add' },
        { text: 'c', type: 'same' },
      ],
    })

    const reverted = await app.inject({
      method: 'POST', url: `/api/nodes/${rootNode.id}/versions/1/revert`,
    })
    expect(reverted.statusCode).toBe(200)
    const revertedNode = deps.nodes.get(rootNode.id)!
    expect(prosemirrorToPlainText(documentContentOf(revertedNode))).toBe('a\nb\nc')
    expect(prosemirrorToPlainText(revertedNode.ai_response)).toBe('a\nx\nc')
    expect(deps.versions.listByNode(rootNode.id).map((version) => version.version_no))
      .toEqual([1, 2, 3])
    await app.close()
  })

  it('returns 404 for missing nodes and versions', async () => {
    const { app, rootNode } = setup()
    expect((await app.inject({ method: 'GET', url: '/api/nodes/missing/versions' })).statusCode)
      .toBe(404)
    expect((await app.inject({
      method: 'GET', url: `/api/nodes/${rootNode.id}/versions/1/diff/99`,
    })).statusCode).toBe(404)
    expect((await app.inject({
      method: 'POST', url: `/api/nodes/${rootNode.id}/versions/99/revert`,
    })).statusCode).toBe(404)
    await app.close()
  })
})
