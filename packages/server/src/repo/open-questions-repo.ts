import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface OpenQuestion {
  id: string; tree_id: string; node_id: string | null; question: string
  status: 'open' | 'resolved'; source: 'ai' | 'manual'; resolved_at: string | null; created_at: string; updated_at: string
}
const normalizeQuestion = (question: string) => question.trim().replace(/\s+/g, ' ')

export function createOpenQuestionsRepo(db: Db, clock: Clock) {
  function get(id: string): OpenQuestion | undefined {
    return db.prepare('SELECT * FROM open_questions WHERE id = ?').get(id) as OpenQuestion | undefined
  }
  function listByTree(treeId: string): OpenQuestion[] {
    return db.prepare('SELECT * FROM open_questions WHERE tree_id = ? ORDER BY created_at, rowid').all(treeId) as OpenQuestion[]
  }
  function upsert(treeId: string, input: { question: string; nodeId?: string | null; source: OpenQuestion['source'] }): OpenQuestion {
    const question = normalizeQuestion(input.question)
    const now = clock.now()
    db.prepare(`INSERT INTO open_questions (id, tree_id, node_id, question, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tree_id, question) DO NOTHING`)
      .run(newId(), treeId, input.nodeId ?? null, question, input.source, now, now)
    return db.prepare('SELECT * FROM open_questions WHERE tree_id = ? AND question = ?').get(treeId, question) as OpenQuestion
  }
  function update(id: string, patch: { question?: string; status?: OpenQuestion['status'] }): OpenQuestion | undefined {
    const current = get(id)
    if (!current) return undefined
    const status = patch.status ?? current.status
    const now = clock.now()
    db.prepare('UPDATE open_questions SET question = ?, status = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
      .run(patch.question === undefined ? current.question : normalizeQuestion(patch.question), status,
        status === 'open' ? null : current.resolved_at ?? now, now, id)
    return get(id)
  }
  return { get, listByTree, upsert, update }
}
