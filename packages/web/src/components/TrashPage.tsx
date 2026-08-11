import type { NodeRow, TreeRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { nodeTitle } from './TreePanel'

export function TrashPage({ onBack, treeId }: { onBack(): void; treeId: string | null }) {
  const api = useApi()
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [trees, setTrees] = useState<TreeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const nodesRequest = treeId ? api.getTrash(treeId) : Promise.resolve({ nodes: [] })
    void Promise.all([nodesRequest, api.listDeletedTrees()])
      .then(([nodeResult, treeResult]) => {
        if (!active) return
        setNodes(nodeResult.nodes)
        setTrees(treeResult.trees)
      })
      .catch(() => { if (active) setError('回收站加载失败，请稍后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, treeId])

  async function restoreNode(node: NodeRow): Promise<void> {
    try {
      await api.restoreNode(node.id)
      setNodes((current) => current.filter((item) => item.id !== node.id))
    } catch { setError(`恢复“${nodeTitle(node)}”失败。`) }
  }

  async function restoreTree(tree: TreeRow): Promise<void> {
    try {
      await api.restoreTree(tree.id)
      setTrees((current) => current.filter((item) => item.id !== tree.id))
    } catch { setError(`恢复“${tree.title}”失败。`) }
  }

  return (
    <main className="trash-page" data-testid="trash-page">
      <header className="trash-page-header">
        <div>
          <span className="eyebrow">独立管理</span>
          <h1>回收站</h1>
          <p>已删除内容不会挤占文档树；可在这里按节点或整棵树恢复。</p>
        </div>
        <button className="quiet-button" onClick={onBack} type="button">返回工作台</button>
      </header>
      {loading ? <p aria-live="polite">正在加载回收站…</p> : (
        <div className="trash-page-grid">
          <section aria-labelledby="deleted-nodes-title" className="trash-section">
            <header><h2 id="deleted-nodes-title">当前树的节点</h2><span>{nodes.length}</span></header>
            {nodes.length === 0 ? <p className="empty-state">没有已删除节点</p> : (
              <ul>{nodes.map((node) => <li key={node.id}><div><strong>{nodeTitle(node)}</strong><span>节点内容</span></div><button onClick={() => { void restoreNode(node) }} type="button">恢复</button></li>)}</ul>
            )}
          </section>
          <section aria-labelledby="deleted-trees-title" className="trash-section">
            <header><h2 id="deleted-trees-title">已删除的树</h2><span>{trees.length}</span></header>
            {trees.length === 0 ? <p className="empty-state">没有已删除的树</p> : (
              <ul>{trees.map((tree) => <li key={tree.id}><div><strong>{tree.title}</strong><span>整棵树</span></div><button onClick={() => { void restoreTree(tree) }} type="button">恢复</button></li>)}</ul>
            )}
          </section>
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </main>
  )
}
