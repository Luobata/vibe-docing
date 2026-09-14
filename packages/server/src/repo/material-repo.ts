import { createHash } from 'node:crypto'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface Material {
  id: string; tree_id: string; title: string; content: string; content_hash: string
  enabled: number; created_at: string; updated_at: string
}
export class MaterialError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const titleOf = (content: string, title?: string) => title?.trim() || content.trim().split(/\r?\n/)[0].slice(0, 40)

export function createMaterialRepo(db: Db, clock: Clock) {
  function get(id: string): Material | undefined {
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as Material | undefined
  }
  function listByTree(treeId: string, enabledOnly = false): Material[] {
    return db.prepare(`SELECT * FROM materials WHERE tree_id = ?${enabledOnly ? ' AND enabled = 1' : ''} ORDER BY updated_at, rowid`).all(treeId) as Material[]
  }
  function validateContent(content: string) {
    if (!content.trim()) throw new MaterialError(400, 'INVALID_MATERIAL', '素材内容不能为空')
    if (content.length > 10_000) throw new MaterialError(400, 'MATERIAL_TOO_LARGE', '单条素材不能超过 10,000 字符，请拆分或精简内容')
  }
  function checkTreeLimit(treeId: string, content: string, exceptId?: string) {
    const others = listByTree(treeId).filter((item) => item.id !== exceptId)
    if (others.length >= 20 || others.reduce((sum, item) => sum + item.content.length, content.length) > 50_000) {
      throw new MaterialError(400, 'TREE_MATERIAL_LIMIT', '每棵树最多保存 20 条素材、合计 50,000 字符，请删除或精简已有素材')
    }
  }
  const create: (treeId: string, input: { content: string; title?: string }) => { material: Material; created: boolean } = db.transaction((treeId: string, input: { content: string; title?: string }) => {
    validateContent(input.content)
    const contentHash = hash(input.content)
    const existing = db.prepare('SELECT * FROM materials WHERE tree_id = ? AND content_hash = ?').get(treeId, contentHash) as Material | undefined
    if (existing) return { material: existing, created: false }
    checkTreeLimit(treeId, input.content)
    const id = newId()
    const now = clock.now()
    db.prepare('INSERT INTO materials (id, tree_id, title, content, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, treeId, titleOf(input.content, input.title), input.content, contentHash, now, now)
    return { material: get(id)!, created: true }
  })
  const update: (id: string, patch: { title?: string; content?: string; enabled?: boolean }) => Material | undefined = db.transaction((id: string, patch: { title?: string; content?: string; enabled?: boolean }) => {
    const current = get(id)
    if (!current) return undefined
    const content = patch.content ?? current.content
    validateContent(content)
    const contentHash = hash(content)
    if (db.prepare('SELECT id FROM materials WHERE tree_id = ? AND content_hash = ? AND id <> ?').get(current.tree_id, contentHash, id)) {
      throw new MaterialError(409, 'MATERIAL_ALREADY_EXISTS', '当前树中已有相同内容的素材')
    }
    checkTreeLimit(current.tree_id, content, id)
    db.prepare('UPDATE materials SET title = ?, content = ?, content_hash = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(patch.title === undefined ? current.title : titleOf(content, patch.title), content, contentHash,
        patch.enabled === undefined ? current.enabled : Number(patch.enabled), clock.now(), id)
    return get(id)!
  })
  function remove(id: string): boolean { return db.prepare('DELETE FROM materials WHERE id = ?').run(id).changes > 0 }
  return { get, listByTree, create, update, remove }
}
