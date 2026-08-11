import { prosemirrorToRenderRuns, type DocumentShareView, type NodeRow, type TreeRow, type VisualArtifact } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { ShareRepo, ShareRow } from '../repo/share-repo'
import { tokenForShare } from '../repo/share-repo'
import type { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { visualReferenceKey, type ShareDocument, type ShareNode } from './share-renderer'

type VisualArtifactRepo = ReturnType<typeof createVisualArtifactRepo>

export function createShareService(db: Db, shares: ShareRepo, visualArtifacts: VisualArtifactRepo) {
  const view = (row: ShareRow, token = tokenForShare(row.id)): DocumentShareView => ({
    enabled: true,
    url: `/share/${token}`,
    markdownUrl: `/share/${token}.md`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  function get(treeId: string): DocumentShareView | null {
    const row = shares.getActiveForTree(treeId)
    return row ? view(row) : null
  }

  function create(treeId: string): DocumentShareView {
    const result = shares.createActive(treeId)
    return view(result.row, result.token)
  }

  function documentForToken(token: string): ShareDocument | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
    const share = shares.getEnabledByToken(token)
    if (!share) return undefined
    const tree = db.prepare('SELECT * FROM trees WHERE id = ? AND is_deleted = 0').get(share.tree_id) as TreeRow | undefined
    if (!tree?.root_node_id) return undefined
    const rows = db.prepare(`SELECT * FROM nodes WHERE tree_id = ? AND is_deleted = 0
      ORDER BY sort_order ASC, id ASC`).all(tree.id) as NodeRow[]
    const byParent = new Map<string | null, NodeRow[]>()
    for (const row of rows) {
      const list = byParent.get(row.parent_id) ?? []
      list.push(row)
      byParent.set(row.parent_id, list)
    }
    const root = rows.find((row) => row.id === tree.root_node_id)
    if (!root) return undefined
    const visuals = new Map<string, VisualArtifact>()
    for (const row of rows) {
      for (const source of [row.user_input, row.ai_response]) {
        for (const run of prosemirrorToRenderRuns(source)) {
          if (run.type !== 'visual') continue
          const key = visualReferenceKey(run.reference)
          if (visuals.has(key)) continue
          try {
            const artifact = visualArtifacts.get(run.reference.artifactId, run.reference.revision)
            if (artifact) visuals.set(key, artifact)
          } catch {
            // A damaged or incompatible artifact must not make the whole public document unavailable.
          }
        }
      }
    }
    const assemble = (row: NodeRow): ShareNode => ({
      row,
      children: (byParent.get(row.id) ?? []).map(assemble),
    })
    return { tree, root: assemble(root), visuals }
  }

  return { create, documentForToken, get, revoke: shares.revoke }
}
