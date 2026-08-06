import type { NodeRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { nodeTitle } from './TreePanel'

export function TrashPanel({ treeId }: { treeId: string }) {
  const api = useApi()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes] = useState<NodeRow[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void api.getTrash(treeId)
      .then((result) => { if (active) setNodes(result.nodes) })
      .catch(() => { if (active) setError('回收站加载失败。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, treeId])

  async function restore(nodeId: string): Promise<void> {
    setError(null)
    try {
      await api.restoreNode(nodeId)
      setNodes((current) => current.filter((node) => node.id !== nodeId))
    } catch {
      setError('恢复失败，请重试。')
    }
  }

  if (loading) return <p aria-live="polite">正在加载回收站…</p>
  return (
    <div className="trash-panel">
      {nodes.length === 0 ? <p className="empty-state">回收站为空</p> : (
        <ul>
          {nodes.map((node) => (
            <li key={node.id}>
              <span>{nodeTitle(node)}</span>
              <button onClick={() => { void restore(node.id) }} type="button">恢复</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
