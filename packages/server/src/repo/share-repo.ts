import { createHash } from 'node:crypto'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

export interface ShareRow {
  id: string
  tree_id: string
  node_id: string
  synthesis_id: string | null
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
const SHARE_TOKEN_DOMAIN = 'document-share:'
export const tokenForShare = (id: string): string =>
  createHash('sha256').update(`${SHARE_TOKEN_DOMAIN}${id}`, 'utf8').digest('base64url')

export interface ShareRepo {
  createActive(treeId: string, nodeId: string): { row: ShareRow; token: string }
  getActiveForNode(nodeId: string): ShareRow | undefined
  getEnabledByToken(token: string): ShareRow | undefined
  revoke(nodeId: string): boolean
  createActiveForSynthesis(treeId: string, nodeId: string, synthesisId: string): { row: ShareRow; token: string }
  getActiveForSynthesis(synthesisId: string): ShareRow | undefined
  revokeSynthesis(synthesisId: string): boolean
}

export function createShareRepo(db: Db, clock: Clock): ShareRepo {
  const createActive = db.transaction((treeId: string, nodeId: string) => {
    const existing = getActiveForNode(nodeId)
    if (existing) return { row: existing, token: tokenForShare(existing.id) }
    const id = newId()
    const token = tokenForShare(id)
    const now = clock.now()
    // Defensive cleanup also makes this safe if legacy data lacked the index.
    db.prepare(`UPDATE document_shares SET is_enabled = 0, updated_at = ?, revoked_at = ?
                WHERE node_id = ? AND is_enabled = 1 AND synthesis_id IS NULL`).run(now, now, nodeId)
    db.prepare(`INSERT INTO document_shares
      (id, tree_id, node_id, token_hash, token_hint, is_enabled, created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL)`)
      .run(id, treeId, nodeId, hashShareToken(token), token.slice(-6), now, now)
    return { row: getActiveForNode(nodeId)!, token }
  })

  function getActiveForNode(nodeId: string): ShareRow | undefined {
    return db.prepare('SELECT * FROM document_shares WHERE node_id = ? AND is_enabled = 1 AND synthesis_id IS NULL')
      .get(nodeId) as ShareRow | undefined
  }

  function getEnabledByToken(token: string): ShareRow | undefined {
    return db.prepare(`SELECT document_shares.* FROM document_shares
      JOIN trees ON trees.id = document_shares.tree_id
      JOIN nodes ON nodes.id = document_shares.node_id AND nodes.tree_id = document_shares.tree_id
      WHERE token_hash = ? AND document_shares.is_enabled = 1
        AND trees.is_deleted = 0 AND nodes.is_deleted = 0
        AND (document_shares.synthesis_id IS NULL OR EXISTS (
          SELECT 1 FROM syntheses WHERE syntheses.id = document_shares.synthesis_id
            AND syntheses.tree_id = document_shares.tree_id AND syntheses.status = 'done'))`)
      .get(hashShareToken(token)) as ShareRow | undefined
  }

  function revoke(nodeId: string): boolean {
    const now = clock.now()
    return db.prepare(`UPDATE document_shares SET is_enabled = 0, updated_at = ?, revoked_at = ?
      WHERE node_id = ? AND is_enabled = 1 AND synthesis_id IS NULL`).run(now, now, nodeId).changes === 1
  }

  function getActiveForSynthesis(synthesisId: string): ShareRow | undefined {
    return db.prepare('SELECT * FROM document_shares WHERE synthesis_id = ? AND is_enabled = 1').get(synthesisId) as ShareRow | undefined
  }
  const createActiveForSynthesis = db.transaction((treeId: string, nodeId: string, synthesisId: string) => {
    const existing = getActiveForSynthesis(synthesisId)
    if (existing) return { row: existing, token: tokenForShare(existing.id) }
    const id = newId()
    const token = tokenForShare(id)
    const now = clock.now()
    db.prepare(`INSERT INTO document_shares (id, tree_id, node_id, synthesis_id, token_hash, token_hint, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, treeId, nodeId, synthesisId, hashShareToken(token), token.slice(-6), now, now)
    return { row: getActiveForSynthesis(synthesisId)!, token }
  })
  function revokeSynthesis(synthesisId: string): boolean {
    const now = clock.now()
    return db.prepare(`UPDATE document_shares SET is_enabled = 0, updated_at = ?, revoked_at = ?
      WHERE synthesis_id = ? AND is_enabled = 1`).run(now, now, synthesisId).changes === 1
  }
  return { createActive, getActiveForNode, getEnabledByToken, revoke, createActiveForSynthesis, getActiveForSynthesis, revokeSynthesis }
}
