import type { NodeRow } from '@vibe/shared'
import { useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'

export function nodeTitle(node: NodeRow | undefined): string {
  if (!node) return '未命名'
  if (!node.parent_id) return node.user_input?.split('\n')[0]?.trim() || '根'
  return node.user_input?.split('\n')[0]?.trim() || '未命名'
}

function countSubtree(nodesById: Record<string, NodeRow>, nodeId: string): number {
  let total = 0
  const stack = [nodeId]
  const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    total += 1
    for (const child of Object.values(nodesById)) {
      if (child.parent_id === current) stack.push(child.id)
    }
  }
  return total
}

function TreeBranch({ nodeId, onDelete }: { nodeId: string; onDelete(id: string): void }) {
  const nodesById = useWorkbench((state) => state.nodesById)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const setMain = useWorkbench((state) => state.setMain)
  const node = nodesById[nodeId]
  if (!node || node.is_deleted === 1) return null
  const children = Object.values(nodesById)
    .filter((candidate) => candidate.parent_id === node.id && candidate.is_deleted === 0)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )

  return (
    <li>
      <div className="tree-node-row">
        <button
          aria-current={mainNodeId === node.id ? 'page' : undefined}
          onClick={() => setMain(node.id)}
          type="button"
        >
          <span aria-hidden="true">{children.length ? '⌄' : '·'}</span>{' '}
          {nodeTitle(node)}
        </button>
        <button
          aria-label={`删除“${nodeTitle(node)}”`}
          className="tree-node-delete"
          onClick={() => onDelete(node.id)}
          type="button"
        >
          ×
        </button>
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeBranch key={child.id} nodeId={child.id} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TreePanel() {
  const api = useApi()
  const rootNodeId = useWorkbench((state) => state.rootNodeId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const setSubtreeDeleted = useWorkbench((state) => state.setSubtreeDeleted)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(id: string): Promise<void> {
    const node = nodesById[id]
    if (node && !node.parent_id) {
      if (!window.confirm(`将删除整棵树“${nodeTitle(node)}”，可在回收站/树列表恢复。`)) return
      setError(null)
      const treeId = useWorkbench.getState().treeId
      try {
        await api.deleteTree(treeId!)
        useWorkbench.getState().reset()
      } catch {
        setError('删除树失败，请稍后重试。')
      }
      return
    }
    const count = countSubtree(nodesById, id)
    const label = nodeTitle(nodesById[id])
    const message = count > 1
      ? `将删除“${label}”及其 ${count - 1} 个子节点（共 ${count} 个），可在回收站恢复。`
      : `将删除“${label}”，可在回收站恢复。`
    if (!window.confirm(message)) return
    setError(null)
    setSubtreeDeleted(id, true)
    setUndoId(id)
    try {
      await api.deleteNode(id)
    } catch {
      setSubtreeDeleted(id, false)
      setUndoId(null)
      setError('删除失败，请稍后重试。')
    }
  }

  async function handleUndo(): Promise<void> {
    if (!undoId) return
    const id = undoId
    setSubtreeDeleted(id, false)
    setUndoId(null)
    try {
      await api.restoreNode(id)
    } catch {
      setError('撤销失败，请到回收站恢复。')
    }
  }

  if (!rootNodeId) return <p className="empty-state">暂无内容</p>
  return (
    <nav aria-label="文档树">
      <ul className="tree-root">
        <TreeBranch nodeId={rootNodeId} onDelete={(id) => { void handleDelete(id) }} />
      </ul>
      {undoId && (
        <div className="tree-undo" role="status">
          <span>已移到回收站</span>
          <button onClick={() => { void handleUndo() }} type="button">撤销</button>
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </nav>
  )
}
