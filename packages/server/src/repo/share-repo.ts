import { createHash } from 'node:crypto'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface ShareRow {
  id: string
  tree_id: string
  token_hash: string
  token_hint: string
  is_enabled: 0 | 1
  created_at: string
  updated_at: string
  revoked_at: string | null
}

export const hashShareToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

// The random row id is non-secret input; the public token is derived rather
// than persisted, while token lookup still uses only its SHA-256 digest.
export const tokenForShare = (id: string): string =>
  createHash('sha256').update(`document-share:${id}`, 'utf8').digest('base64url')

export interface ShareRepo {
  createActive(treeId: string): { row: ShareRow; token: string }
  getActiveForTree(treeId: string): ShareRow | undefined
  getEnabledByToken(token: string): ShareRow | undefined
  revoke(treeId: string): boolean
}

export function createShareRepo(db: Db, clock: Clock): ShareRepo {
  const createActive = db.transaction((treeId: string) => {
    const existing = getActiveForTree(treeId)
    if (existing) return { row: existing, token: tokenForShare(existing.id) }
    const id = newId()
    const token = tokenForShare(id)
    const now = clock.now()
    // Defensive cleanup also makes this safe if legacy data lacked the index.
    db.prepare(`UPDATE document_shares SET is_enabled = 0, updated_at = ?, revoked_at = ?
                WHERE tree_id = ? AND is_enabled = 1`).run(now, now, treeId)
    db.prepare(`INSERT INTO document_shares
      (id, tree_id, token_hash, token_hint, is_enabled, created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`)
      .run(id, treeId, hashShareToken(token), token.slice(-6), now, now)
    return { row: getActiveForTree(treeId)!, token }
  })

  function getActiveForTree(treeId: string): ShareRow | undefined {
    return db.prepare('SELECT * FROM document_shares WHERE tree_id = ? AND is_enabled = 1')
      .get(treeId) as ShareRow | undefined
  }

  function getEnabledByToken(token: string): ShareRow | undefined {
    return db.prepare(`SELECT document_shares.* FROM document_shares
      JOIN trees ON trees.id = document_shares.tree_id
      WHERE token_hash = ? AND document_shares.is_enabled = 1 AND trees.is_deleted = 0`)
      .get(hashShareToken(token)) as ShareRow | undefined
  }

  function revoke(treeId: string): boolean {
    const now = clock.now()
    return db.prepare(`UPDATE document_shares SET is_enabled = 0, updated_at = ?, revoked_at = ?
      WHERE tree_id = ? AND is_enabled = 1`).run(now, now, treeId).changes === 1
  }

  return { createActive, getActiveForTree, getEnabledByToken, revoke }
}
