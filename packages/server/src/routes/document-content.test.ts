import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-12T12:00:00.000Z'),
    db: openMemoryDb(),
  })
  const { rootNode } = deps.trees.create('editable')
  return { app: buildApp(deps), deps, rootNode }
}

const doc = (text: string) => ({
  content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }],
  type: 'doc',
})

describe('document content route', () => {
  it('saves byte-preserving Markdown as a Vault file', async () => {
    const { app, deps, rootNode } = setup()
    const source = '---\nlink: "[[A]]" # keep\n---\n\n> [!note]\n> Native\n\n```dataview\nLIST\n```\n'
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 0,
        editSessionId: 'markdown-session',
        fileKind: 'markdown',
        schemaVersion: 2,
        source,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      content: { fileKind: 'markdown', revision: 1, schemaVersion: 2, source },
      node: { ai_response: null, document_content: source, content_schema_version: 2, file_kind: 'markdown' },
    })
    const node = deps.nodes.get(rootNode.id)!
    expect(node.file_path).toMatch(/\.md$/)
    expect(deps.vault.hydrateNode(node).document_content).toBe(source)
    await app.close()
  })

  it('rejects malformed JSON Canvas without rewriting it', async () => {
    const { app, deps, rootNode } = setup()
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 0,
        editSessionId: 'canvas-session',
        fileKind: 'canvas',
        schemaVersion: 2,
        source: '{broken',
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(response.statusCode).toBe(400)
    expect(deps.nodes.get(rootNode.id)?.ai_response).toBeNull()
    await app.close()
  })

  it('saves semantic content and coalesces one edit session into one version', async () => {
    const { app, deps, rootNode } = setup()
    const first = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 0,
        doc: doc('first'),
        editSessionId: 'session-1',
        schemaVersion: 1,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      content: { revision: 1, schemaVersion: 1 },
      node: { content_revision: 1, content_schema_version: 1 },
    })

    const second = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 1,
        doc: doc('second'),
        editSessionId: 'session-1',
        schemaVersion: 1,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toMatchObject({ content: { revision: 2 } })
    expect(deps.versions.listByNode(rootNode.id)).toMatchObject([
      { content_revision: 2, edit_session_id: 'session-1', version_no: 1 },
    ])
    await app.close()
  })

  it('updates annotation anchors atomically with the document', async () => {
    const { app, deps, rootNode } = setup()
    const annotation = deps.annotations.create({
      anchorFrom: 0,
      anchorTo: 3,
      kind: 'selection',
      nodeId: rootNode.id,
      quotedText: 'old',
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        anchors: [{ from: 4, id: annotation.id, quotedText: 'new', status: 'valid', to: 7 }],
        baseRevision: 0,
        doc: doc('the new text'),
        editSessionId: 'session-anchor',
        schemaVersion: 1,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(response.statusCode).toBe(200)
    expect(deps.annotations.get(annotation.id)).toMatchObject({
      anchor_from: 4,
      anchor_status: 'valid',
      anchor_to: 7,
      quoted_text: 'new',
    })
    await app.close()
  })

  it('rejects stale revisions without changing content', async () => {
    const { app, deps, rootNode } = setup()
    deps.nodes.updateDocumentContent({
      baseRevision: 0,
      content: JSON.stringify(doc('server')),
      id: rootNode.id,
      schemaVersion: 1,
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 0,
        doc: doc('stale'),
        editSessionId: 'session-stale',
        schemaVersion: 1,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ currentRevision: 1, error: 'content conflict' })
    expect(deps.nodes.get(rootNode.id)?.document_content).toBe(JSON.stringify(doc('server')))
    await app.close()
  })

  it('rejects unsafe or malformed ProseMirror documents', async () => {
    const { app, rootNode } = setup()
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        baseRevision: 0,
        doc: {
          content: [{ marks: [{ attrs: { href: 'javascript:alert(1)' }, type: 'link' }], text: 'x', type: 'text' }],
          type: 'doc',
        },
        editSessionId: 'session-invalid',
        schemaVersion: 1,
      },
      url: `/api/nodes/${rootNode.id}/content`,
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })
})
