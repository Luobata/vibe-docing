import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './db/connection'
import { createDeps } from './deps'
import { fixedClock } from './util/clock'

describe('createDeps', () => {
  it('accepts isolated provider environment and an injectable connection fetch', () => {
    const providerFetch = async () => new Response('{}')
    const deps = createDeps({ db: openMemoryDb(), env: { VIBE_LLM_MODEL: 'injected-model' }, providerFetch })
    expect(deps.settings.getProviderConfig().model).toBe('injected-model')
    expect(deps.providerFetch).toBe(providerFetch)
    deps.db.close()
  })

  it('wires repos, context engine, answer service, and settings', () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
      env: {},
    })
    const { tree } = deps.trees.create('tree')

    expect(deps.nodes.get(tree.root_node_id!)).toBeTruthy()
    expect(deps.context.assemble(tree.root_node_id!, 'hello')).toEqual([
      { content: 'hello', role: 'user' },
    ])
    expect(deps.answer.generate).toBeTypeOf('function')
    expect(deps.discussion.discuss).toBeTypeOf('function')
    expect(deps.discussion.promote).toBeTypeOf('function')
    expect(deps.discussionMessages.listByNode(tree.root_node_id!)).toEqual([])
    expect(deps.settings.getProviderConfig().provider).toBe('codex')
  })
})
