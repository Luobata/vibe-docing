import type { NodeRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface SynthesisSection { key: string; title: string; content: string }
export interface SynthesisFootnote { number: number; nodeId: string; title: string; path: string[] }
export interface SynthesisNodeResult {
  nodeId: string; cacheKey: string; status: 'done' | 'failed'; content: string; error?: string; cached?: boolean
}
export interface Synthesis {
  id: string; treeId: string; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  contentMd: string | null; sections: SynthesisSection[]; footnotes: SynthesisFootnote[]
  nodeResults: Record<string, SynthesisNodeResult>; inputDigest: string; error: string | null
  createdAt: string; updatedAt: string; finishedAt: string | null
}
interface SynthesisRow {
  id: string; tree_id: string; status: Synthesis['status']; content_md: string | null
  sections_json: string; footnotes_json: string; node_results_json: string; input_digest: string
  error: string | null; created_at: string; updated_at: string; finished_at: string | null
}
export interface Retrospective { id: string; tree_id: string; input_digest: string; content_md: string; created_at: string }

function decode(row: SynthesisRow): Synthesis {
  return { id: row.id, treeId: row.tree_id, status: row.status, contentMd: row.content_md,
    sections: JSON.parse(row.sections_json), footnotes: JSON.parse(row.footnotes_json), nodeResults: JSON.parse(row.node_results_json),
    inputDigest: row.input_digest, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at }
}

export class SynthesisRunningError extends Error {
  constructor(public synthesisId: string) { super('该树已有成文任务正在运行') }
}

export function createSynthesisRepo(db: Db, clock: Clock) {
  function get(id: string): Synthesis | undefined {
    const row = db.prepare('SELECT * FROM syntheses WHERE id = ?').get(id) as SynthesisRow | undefined
    return row && decode(row)
  }
  function listByTree(treeId: string): Synthesis[] {
    return (db.prepare('SELECT * FROM syntheses WHERE tree_id = ? ORDER BY created_at DESC, rowid DESC').all(treeId) as SynthesisRow[]).map(decode)
  }
  const create: (treeId: string, inputDigest: string, footnotes: SynthesisFootnote[]) => Synthesis = db.transaction((treeId: string, inputDigest: string, footnotes: SynthesisFootnote[]) => {
    const active = db.prepare("SELECT id FROM syntheses WHERE tree_id = ? AND status IN ('queued', 'running')").get(treeId) as { id: string } | undefined
    if (active) throw new SynthesisRunningError(active.id)
    const id = newId()
    const now = clock.now()
    db.prepare(`INSERT INTO syntheses (id, tree_id, status, input_digest, footnotes_json, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?)`).run(id, treeId, inputDigest, JSON.stringify(footnotes), now, now)
    return get(id)!
  })
  function begin(id: string): boolean {
    return db.prepare("UPDATE syntheses SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'").run(clock.now(), id).changes === 1
  }
  const saveNodeResult: (id: string, result: SynthesisNodeResult) => boolean = db.transaction((id: string, result: SynthesisNodeResult) => {
    const current = get(id)
    if (current?.status !== 'running') return false
    db.prepare('UPDATE syntheses SET node_results_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...current.nodeResults, [result.nodeId]: result }), clock.now(), id)
    return true
  })
  function finish(id: string, result: { status: 'done' | 'failed' | 'cancelled'; contentMd?: string; sections?: SynthesisSection[]; error?: string }): Synthesis | undefined {
    const now = clock.now()
    db.prepare(`UPDATE syntheses SET status = ?, content_md = ?, sections_json = ?, error = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`).run(result.status, result.contentMd ?? null, JSON.stringify(result.sections ?? []), result.error ?? null, now, now, id)
    return get(id)
  }
  function cachedNode(treeId: string, nodeId: string, cacheKey: string): SynthesisNodeResult | undefined {
    for (const synthesis of listByTree(treeId)) {
      const result = synthesis.nodeResults[nodeId]
      if (result?.status === 'done' && result.cacheKey === cacheKey) return result
    }
    return undefined
  }
  function completed(treeId: string, inputDigest: string): Synthesis | undefined {
    return listByTree(treeId).find((item) => item.status === 'done' && item.inputDigest === inputDigest
      && Object.values(item.nodeResults).every((result) => result.status === 'done'))
  }
  function setVerdict(nodeId: string, verdict: NonNullable<NodeRow['verdict']> | null): void {
    db.prepare('UPDATE nodes SET verdict = ?, updated_at = ? WHERE id = ? AND is_deleted = 0').run(verdict, clock.now(), nodeId)
  }
  function retrospective(treeId: string, digest?: string): Retrospective | undefined {
    return digest === undefined
      ? db.prepare('SELECT * FROM retrospectives WHERE tree_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(treeId) as Retrospective | undefined
      : db.prepare('SELECT * FROM retrospectives WHERE tree_id = ? AND input_digest = ?').get(treeId, digest) as Retrospective | undefined
  }
  function saveRetrospective(treeId: string, digest: string, contentMd: string): Retrospective {
    db.prepare(`INSERT INTO retrospectives (id, tree_id, input_digest, content_md, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(tree_id, input_digest) DO NOTHING`).run(newId(), treeId, digest, contentMd, clock.now())
    return retrospective(treeId, digest)!
  }
  return { create, get, listByTree, begin, saveNodeResult, finish, cachedNode, completed, setVerdict, retrospective, saveRetrospective }
}
