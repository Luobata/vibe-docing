import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { plainTextToProseMirror } from '../context/prosemirror'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-05T00:00:00.000Z'),
    db: openMemoryDb(),
  })
  const { rootNode } = deps.trees.create('tree')
  return { app: buildApp(deps), deps, rootNode }
}

describe('node edit route', () => {
  it('creates a blank editable child without starting AI generation', async () => {
    const { app, deps, rootNode } = setup()
    const response = await app.inject({
      method: 'POST',
      payload: { title: '会议记录' },
      url: `/api/nodes/${rootNode.id}/children`,
    })
    expect(response.statusCode).toBe(200)
    const created = response.json<{ node: { document_content: string; id: string; parent_id: string; status: string; user_input: string } }>().node
    expect(created).toMatchObject({
      document_content: '',
      parent_id: rootNode.id,
      status: 'complete',
      user_input: '会议记录',
    })
    expect(deps.versions.listByNode(created.id)).toMatchObject([
      { change_kind: 'edit', document_content: '', version_no: 1 },
    ])
    await app.close()
  })

  it('rejects an empty blank-note title and a missing parent', async () => {
    const { app, rootNode } = setup()
    expect((await app.inject({
      method: 'POST', payload: { title: '   ' }, url: `/api/nodes/${rootNode.id}/children`,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'POST', payload: { title: '笔记' }, url: '/api/nodes/missing/children',
    })).statusCode).toBe(404)
    await app.close()
  })

  it('edits content and appends an edit version', async () => {
    const { app, deps, rootNode } = setup()
    const generated = plainTextToProseMirror('原始模型输出')
    deps.nodes.updateGeneration(rootNode.id, { aiResponse: generated })
    const edited = plainTextToProseMirror('修改后的回答')
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        aiResponse: edited,
        userInput: '修改后的问题',
      },
      url: `/api/nodes/${rootNode.id}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ node: {
      ai_response: generated,
      document_content: edited,
      user_input: '修改后的问题',
    } })
    expect(deps.versions.listByNode(rootNode.id)).toMatchObject([
      { change_kind: 'edit', version_no: 1 },
    ])
    await app.close()
  })

  it('rejects empty/invalid bodies and missing nodes', async () => {
    const { app, rootNode } = setup()
    expect((await app.inject({
      method: 'PATCH', payload: {}, url: `/api/nodes/${rootNode.id}`,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'PATCH', payload: { aiResponse: 'not-json' }, url: `/api/nodes/${rootNode.id}`,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'PATCH', payload: { userInput: 'q' }, url: '/api/nodes/missing',
    })).statusCode).toBe(404)
    await app.close()
  })
})
