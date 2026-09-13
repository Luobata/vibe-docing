import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface DiscussionMessage {
  id: string
  node_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  promoted_node_id: string | null
  promoted_mode: 'section' | 'child' | null
}

export function createDiscussionRepo(db: Db, clock: Clock) {
  function listByNode(nodeId: string, limit?: number): DiscussionMessage[] {
    if (limit !== undefined) {
      return (db.prepare(`SELECT * FROM discussion_messages WHERE node_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(nodeId, limit) as DiscussionMessage[]).reverse()
    }
    return db.prepare(`SELECT * FROM discussion_messages WHERE node_id = ?
      ORDER BY created_at ASC, rowid ASC`).all(nodeId) as DiscussionMessage[]
  }

  function append(input: { nodeId: string; role: DiscussionMessage['role']; content: string }): DiscussionMessage {
    const id = newId()
    db.prepare(`INSERT INTO discussion_messages (id, node_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, input.nodeId, input.role, input.content, clock.now())
    return db.prepare('SELECT * FROM discussion_messages WHERE id = ?').get(id) as DiscussionMessage
  }

  function markPromoted(id: string, nodeId: string, mode: 'section' | 'child'): void {
    db.prepare('UPDATE discussion_messages SET promoted_node_id = ?, promoted_mode = ? WHERE id = ?')
      .run(nodeId, mode, id)
  }

  return { listByNode, append, markPromoted }
}
