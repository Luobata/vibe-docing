import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { plainTextToProseMirror, prosemirrorToPlainText } from '../context/prosemirror'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-05T00:00:00.000Z'),
    db: openMemoryDb(),
  })
  const { rootNode } = deps.trees.create('tree')
  for (const answer of ['a\nb\nc', 'a\nx\nc']) {
    const aiResponse = plainTextToProseMirror(answer)
    deps.nodes.updateContent(rootNode.id, { aiResponse, status: 'complete' })
    deps.versions.snapshot({
      aiResponse,
      changeKind: 'edit',
      nodeId: rootNode.id,
      userInput: null,
    })
  }
  return { app: buildApp(deps), deps, rootNode }
}

describe('version routes', () => {
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
    expect(prosemirrorToPlainText(deps.nodes.get(rootNode.id)!.ai_response)).toBe('a\nb\nc')
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
