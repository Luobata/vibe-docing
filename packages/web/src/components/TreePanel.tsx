import type { NodeRow } from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'

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

interface PendingNodeDelete {
  id: string
  isRoot: boolean
  message: string
  trigger: HTMLButtonElement
}

function TreeBranch({ collapsedIds, depth, nodeId, onDelete, onNodeSelect, onToggle }: {
  collapsedIds: ReadonlySet<string>
  depth: number
  nodeId: string
  onDelete(id: string, trigger: HTMLButtonElement): void
  onNodeSelect?(): void
  onToggle(id: string): void
}) {
  const nodesById = useWorkbench((state) => state.nodesById)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const setMain = useWorkbench((state) => state.setMain)
  const unreadNodeIds = useWorkbench((state) => state.unreadNodeIds)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
  const node = nodesById[nodeId]
  if (!node || node.is_deleted === 1) return null
  const children = Object.values(nodesById)
    .filter((candidate) => candidate.parent_id === node.id && candidate.is_deleted === 0)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )
  const expanded = children.length > 0 && !collapsedIds.has(node.id)
  const taskKey = taskKeyByTarget[node.id]
  const task = taskKey ? tasksByKey[taskKey] : undefined
  const generating = task?.status === 'streaming' || node.status === 'streaming'
  const unread = unreadNodeIds.includes(node.id)

  return (
    <li className="tree-branch" data-depth={depth}>
      <div className="tree-node-row" data-generating={generating || undefined} data-unread={unread || undefined}>
        <button
          aria-label={children.length ? `${expanded ? '收起' : '展开'}“${nodeTitle(node)}”` : undefined}
          aria-expanded={children.length ? expanded : undefined}
          className="tree-node-toggle"
          disabled={children.length === 0}
          onClick={() => onToggle(node.id)}
          tabIndex={children.length ? 0 : -1}
          type="button"
        >
          <span aria-hidden="true">{children.length ? '›' : '•'}</span>
        </button>
        <button
          aria-label={nodeTitle(node)}
          aria-current={mainNodeId === node.id ? 'page' : undefined}
          className="tree-node-main"
          onClick={() => { setMain(node.id); onNodeSelect?.() }}
          title={nodeTitle(node)}
          type="button"
        >
          <span aria-hidden="true" className="tree-node-kind">{node.parent_id ? '◇' : '◆'}</span>
          <span className="tree-node-title">{nodeTitle(node)}</span>
          {generating && <span aria-label="生成中" className="tree-node-status is-generating"><span aria-hidden="true" /></span>}
          {!generating && unread && <span aria-label="未读" className="tree-node-status is-unread"><span aria-hidden="true" /></span>}
        </button>
        <button
          aria-label={`删除“${nodeTitle(node)}”`}
          className="tree-node-delete"
          onClick={(event) => onDelete(node.id, event.currentTarget)}
          type="button"
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul>
          {children.map((child) => (
            <TreeBranch
              collapsedIds={collapsedIds}
              depth={depth + 1}
              key={child.id}
              nodeId={child.id}
              onDelete={onDelete}
              onNodeSelect={onNodeSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TreePanel({ onNodeSelect }: { onNodeSelect?(): void } = {}) {
  const api = useApi()
  const rootNodeId = useWorkbench((state) => state.rootNodeId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const setSubtreeDeleted = useWorkbench((state) => state.setSubtreeDeleted)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorPaused, setErrorPaused] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingNodeDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    if (!error || errorPaused) return
    errorTimerRef.current = setTimeout(() => setError(null), 8000)
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [error, errorPaused])

  function requestDelete(id: string, trigger: HTMLButtonElement): void {
    const node = nodesById[id]
    if (node && !node.parent_id) {
      setDeleteError(null)
      setPendingDelete({
        id,
        isRoot: true,
        message: `将删除整棵树“${nodeTitle(node)}”，可在回收站/树列表恢复。`,
        trigger,
      })
      return
    }
    const count = countSubtree(nodesById, id)
    const label = nodeTitle(nodesById[id])
    const message = count > 1
      ? `将删除“${label}”及其 ${count - 1} 个子节点（共 ${count} 个），可在回收站恢复。`
      : `将删除“${label}”，可在回收站恢复。`
    setDeleteError(null)
    setPendingDelete({ id, isRoot: false, message, trigger })
  }

  function toggleNode(id: string): void {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, isRoot } = pendingDelete
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (isRoot) {
        const treeId = useWorkbench.getState().treeId
        await api.deleteTree(treeId!)
        setPendingDelete(null)
        useWorkbench.getState().reset()
        return
      }
      await api.deleteNode(id)
      setSubtreeDeleted(id, true)
      setUndoId(id)
      setPendingDelete(null)
    } catch {
      setDeleteError(isRoot ? '删除树失败，请稍后重试。' : '删除失败，请稍后重试。')
    } finally {
      setDeleteBusy(false)
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
        <TreeBranch collapsedIds={collapsedIds} depth={0} nodeId={rootNodeId} onDelete={requestDelete} onNodeSelect={onNodeSelect} onToggle={toggleNode} />
      </ul>
      {undoId && (
        <div className="tree-undo" role="status">
          <span>已移到回收站</span>
          <button onClick={() => { void handleUndo() }} type="button">撤销</button>
        </div>
      )}
      {error && (
        <div
          className="inline-error dismissible-notice"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setErrorPaused(false)
          }}
          onFocus={() => setErrorPaused(true)}
          onMouseEnter={() => setErrorPaused(true)}
          onMouseLeave={() => setErrorPaused(false)}
          role="alert"
        >
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError(null)} type="button">×</button>
        </div>
      )}
      {pendingDelete && (
        <ConfirmDialog
          busy={deleteBusy}
          error={deleteError}
          message={pendingDelete.message}
          onCancel={() => {
            setDeleteError(null)
            setPendingDelete(null)
          }}
          onConfirm={confirmDelete}
          returnFocusTo={pendingDelete.trigger}
        />
      )}
    </nav>
  )
}
