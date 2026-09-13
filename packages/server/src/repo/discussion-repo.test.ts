import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

describe('discussion repository', () => {
  it('preserves append order at equal timestamps, scopes by node, and marks promotion', () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-09-13T00:00:00.000Z') })
    try {
      const first = deps.trees.create('First').rootNode
      const second = deps.trees.create('Second').rootNode
      const user = deps.discussionMessages.append({ nodeId: first.id, role: 'user', content: 'Question' })
      const assistant = deps.discussionMessages.append({ nodeId: first.id, role: 'assistant', content: 'Answer' })
      deps.discussionMessages.append({ nodeId: second.id, role: 'user', content: 'Unrelated' })
      expect(deps.discussionMessages.listByNode(first.id)).toEqual([user, assistant])
      expect(deps.discussionMessages.listByNode(first.id, 1)).toEqual([assistant])
      deps.discussionMessages.markPromoted(assistant.id, second.id, 'child')
      expect(deps.discussionMessages.listByNode(first.id)[1]).toMatchObject({ promoted_node_id: second.id, promoted_mode: 'child' })
      deps.discussionMessages.markPromoted(user.id, first.id, 'section')
      expect(deps.discussionMessages.listByNode(first.id)[0]).toMatchObject({ promoted_node_id: first.id, promoted_mode: 'section' })
    } finally { deps.db.close() }
  })

  it('enforces node, role, and promotion mode constraints', () => {
    const deps = createDeps({ db: openMemoryDb() })
    try {
      expect(() => deps.discussionMessages.append({ nodeId: 'absent', role: 'user', content: 'x' })).toThrow()
      const node = deps.trees.create('Note').rootNode
      expect(() => deps.discussionMessages.append({ nodeId: node.id, role: 'tool' as never, content: 'x' })).toThrow()
      const message = deps.discussionMessages.append({ nodeId: node.id, role: 'user', content: 'x' })
      expect(() => deps.discussionMessages.markPromoted(message.id, node.id, 'correction' as never)).toThrow()
    } finally { deps.db.close() }
  })
})
