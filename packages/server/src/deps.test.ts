import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './db/connection'
import { createDeps } from './deps'
import { fixedClock } from './util/clock'

describe('createDeps', () => {
  it('wires repos, context engine, answer service, and settings', () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
    })
    const { tree } = deps.trees.create('tree')

    expect(deps.nodes.get(tree.root_node_id!)).toBeTruthy()
    expect(deps.context.assemble(tree.root_node_id!, 'hello')).toEqual([
      { content: 'hello', role: 'user' },
    ])
    expect(deps.answer.generate).toBeTypeOf('function')
    expect(deps.settings.getProviderConfig().provider).toBe('codex')
  })
})
