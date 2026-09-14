import { documentContentOf, prosemirrorToRenderRuns, type AnnotationKind, type DocumentShareView, type NodeRow, type TreeRow, type VisualArtifact } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { ShareRepo, ShareRow } from '../repo/share-repo'
import { tokenForShare } from '../repo/share-repo'
import type { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { visualReferenceKey, type ShareDocument, type ShareNode } from './share-renderer'

type VisualArtifactRepo = ReturnType<typeof createVisualArtifactRepo>

export function createShareService(db: Db, shares: ShareRepo, visualArtifacts: VisualArtifactRepo) {
  const view = (row: ShareRow, token = tokenForShare(row.id)): DocumentShareView => ({
    enabled: true,
    nodeId: row.node_id,
    ...(row.synthesis_id ? { synthesisId: row.synthesis_id } : {}),
    url: `/share/${token}`,
    markdownUrl: `/share/${token}.md`,
    jsonUrl: `/share/${token}.json`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  function get(nodeId: string): DocumentShareView | null {
    const row = shares.getActiveForNode(nodeId)
    return row ? view(row) : null
  }

  function create(treeId: string, nodeId: string): DocumentShareView {
    const result = shares.createActive(treeId, nodeId)
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
    if (share.synthesis_id) {
      const synthesis = db.prepare("SELECT id, content_md FROM syntheses WHERE id = ? AND tree_id = ? AND status = 'done'")
        .get(share.synthesis_id, tree.id) as { id: string; content_md: string } | undefined
      const root = rows.find((row) => row.id === share.node_id)
      if (!synthesis || !root) return undefined
      return { tree, root: { row: root, children: [] }, synthesis: { id: synthesis.id, contentMd: synthesis.content_md },
        shareCreatedAt: share.created_at, shareUpdatedAt: share.updated_at }
    }
    const byParent = new Map<string | null, NodeRow[]>()
    for (const row of rows) {
      const list = byParent.get(row.parent_id) ?? []
      list.push(row)
      byParent.set(row.parent_id, list)
    }
    const root = rows.find((row) => row.id === share.node_id)
    if (!root) return undefined
    const assemble = (row: NodeRow): ShareNode => ({
      row,
      children: (byParent.get(row.id) ?? []).map(assemble),
    })
    const assembledRoot = assemble(root)
    const includedIds = new Set<string>()
    const collectIds = (node: ShareNode): void => { includedIds.add(node.row.id); node.children.forEach(collectIds) }
    collectIds(assembledRoot)
    const annotations = new Map<string, Array<{ kind: AnnotationKind; quotedText: string | null; note: string | null; childNodeId: string | null }>>()
    const annotationRows = db.prepare(`SELECT node_id, kind, quoted_text, note, child_node_id
      FROM annotations WHERE node_id IN (${[...includedIds].map(() => '?').join(',')})
      ORDER BY created_at ASC, id ASC`).all(...includedIds) as Array<{
        node_id: string; kind: AnnotationKind; quoted_text: string | null; note: string | null; child_node_id: string | null
      }>
    for (const annotation of annotationRows) {
      const list = annotations.get(annotation.node_id) ?? []
      list.push({ kind: annotation.kind, quotedText: annotation.quoted_text, note: annotation.note,
        childNodeId: annotation.child_node_id && includedIds.has(annotation.child_node_id) ? annotation.child_node_id : null })
      annotations.set(annotation.node_id, list)
    }
    const visuals = new Map<string, VisualArtifact>()
    const visit = (node: ShareNode): void => {
      const row = node.row
      for (const source of [row.user_input, documentContentOf(row)]) {
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
      for (const child of node.children) visit(child)
    }
    visit(assembledRoot)
    return { tree, root: assembledRoot, visuals, annotations, shareCreatedAt: share.created_at, shareUpdatedAt: share.updated_at }
  }

  function getSynthesis(synthesisId: string): DocumentShareView | null {
    const row = shares.getActiveForSynthesis(synthesisId)
    return row ? view(row) : null
  }
  function createSynthesis(treeId: string, nodeId: string, synthesisId: string): DocumentShareView {
    const result = shares.createActiveForSynthesis(treeId, nodeId, synthesisId)
    return view(result.row, result.token)
  }
  return { create, documentForToken, get, revoke: shares.revoke, getSynthesis, createSynthesis, revokeSynthesis: shares.revokeSynthesis }
}
