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
  it('edits content and appends an edit version', async () => {
    const { app, deps, rootNode } = setup()
    const response = await app.inject({
      method: 'PATCH',
      payload: {
        aiResponse: plainTextToProseMirror('修改后的回答'),
        userInput: '修改后的问题',
      },
      url: `/api/nodes/${rootNode.id}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ node: { user_input: '修改后的问题' } })
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
