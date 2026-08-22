import type { NodeRow } from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'

export function nodeTitle(node: NodeRow | undefined, rootTitle?: string | null): string {
  if (!node) return '未命名'
  if (!node.parent_id) return rootTitle?.trim() || node.user_input?.split('\n')[0]?.trim() || '根'
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

function TreeBranch({ collapsedIds, depth, editingId, editingTitle, nodeId, onDelete, onNodeSelect, onRenameCancel, onRenameChange, onRenameCommit, onRenameStart, onToggle, renameBusy }: {
  collapsedIds: ReadonlySet<string>
  depth: number
  editingId: string | null
  editingTitle: string
  nodeId: string
  onDelete(id: string, trigger: HTMLButtonElement): void
  onNodeSelect?(): void
  onRenameCancel(): void
  onRenameChange(value: string): void
  onRenameCommit(id: string): void
  onRenameStart(id: string): void
  onToggle(id: string): void
  renameBusy: boolean
}) {
  const nodesById = useWorkbench((state) => state.nodesById)
  const treeTitle = useWorkbench((state) => state.treeTitle)
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
  const rootDisplayLabel = !node.parent_id && treeTitle?.trim() ? '主笔记' : null
  const displayLabel = rootDisplayLabel ?? nodeTitle(node, treeTitle)
  const accessibleLabel = rootDisplayLabel ? `${rootDisplayLabel}（${treeTitle}）` : displayLabel

  return (
    <li className="tree-branch" data-depth={depth}>
      <div className="tree-node-row" data-generating={generating || undefined} data-unread={unread || undefined}>
        <button
          aria-label={children.length ? `${expanded ? '收起' : '展开'}“${accessibleLabel}”` : undefined}
          aria-expanded={children.length ? expanded : undefined}
          className="tree-node-toggle"
          disabled={children.length === 0}
          onClick={() => onToggle(node.id)}
          tabIndex={children.length ? 0 : -1}
          type="button"
        >
          <span aria-hidden="true">{children.length ? <Icon name="chevron-right" size={13} /> : null}</span>
        </button>
        {editingId === node.id ? (
          <input
            aria-label={`重命名“${displayLabel}”`}
            autoFocus
            className="tree-node-rename-input"
            disabled={renameBusy}
            onBlur={() => onRenameCommit(node.id)}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { event.preventDefault(); onRenameCommit(node.id) }
              if (event.key === 'Escape') { event.preventDefault(); onRenameCancel() }
            }}
            value={editingTitle}
          />
        ) : (
          <button
            aria-label={accessibleLabel}
            aria-current={mainNodeId === node.id ? 'page' : undefined}
            className="tree-node-main"
            onClick={() => { setMain(node.id); onNodeSelect?.() }}
            title={accessibleLabel}
            type="button"
          >
            <span aria-hidden="true" className="tree-node-kind"><Icon name={node.parent_id ? 'note' : 'doc'} size={13} /></span>
            <span className="tree-node-title">{displayLabel}</span>
            {generating && <span aria-label="生成中" className="tree-node-status is-generating"><span aria-hidden="true" /></span>}
            {!generating && unread && <span aria-label="未读" className="tree-node-status is-unread"><span aria-hidden="true" /></span>}
          </button>
        )}
        {node.parent_id && editingId !== node.id && (
          <button
            aria-label={`重命名“${displayLabel}”`}
            className="tree-node-action tree-node-rename"
            disabled={generating}
            onClick={() => onRenameStart(node.id)}
            title="仅修改标题，不会重新生成正文"
            type="button"
          >
            <Icon name="edit" size={14} />
          </button>
        )}
        <button
          aria-label={`删除“${nodeTitle(node, treeTitle)}”`}
          className="tree-node-action tree-node-delete"
          disabled={renameBusy && editingId === node.id}
          onClick={(event) => onDelete(node.id, event.currentTarget)}
          title="移到回收站"
          type="button"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      {expanded && (
        <ul>
          {children.map((child) => (
            <TreeBranch
              collapsedIds={collapsedIds}
              depth={depth + 1}
              editingId={editingId}
              editingTitle={editingTitle}
              key={child.id}
              nodeId={child.id}
              onDelete={onDelete}
              onNodeSelect={onNodeSelect}
              onRenameCancel={onRenameCancel}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameStart={onRenameStart}
              onToggle={onToggle}
              renameBusy={renameBusy}
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
  const treeTitle = useWorkbench((state) => state.treeTitle)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const setMain = useWorkbench((state) => state.setMain)
  const setSubtreeDeleted = useWorkbench((state) => state.setSubtreeDeleted)
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorPaused, setErrorPaused] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingNodeDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [blankTitle, setBlankTitle] = useState('')
  const [blankOpen, setBlankOpen] = useState(false)
  const [blankBusy, setBlankBusy] = useState(false)
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
        message: `将删除笔记库“${nodeTitle(node, treeTitle)}”及其中全部内容，可在回收站恢复。`,
        trigger,
      })
      return
    }
    const count = countSubtree(nodesById, id)
    const label = nodeTitle(nodesById[id], treeTitle)
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

  function beginRename(id: string): void {
    const node = nodesById[id]
    if (!node || !node.parent_id) return
    setEditingId(id)
    setEditingTitle(nodeTitle(node, treeTitle))
  }

  async function commitRename(id: string): Promise<void> {
    if (editingId !== id || renameBusy) return
    const node = nodesById[id]
    const title = editingTitle.trim()
    if (!node || !title) {
      if (!title) setError('标题不能为空。')
      setEditingId(null)
      return
    }
    if (title === nodeTitle(node, treeTitle)) {
      setEditingId(null)
      return
    }
    setRenameBusy(true)
    setError(null)
    try {
      const lines = (node.user_input ?? '').split('\n')
      lines[0] = title
      const result = await api.editNode(id, { userInput: lines.join('\n') })
      upsertNode(result.node)
      setEditingId(null)
    } catch {
      setError('重命名失败，正文没有改变，请重试。')
    } finally {
      setRenameBusy(false)
    }
  }

  async function createBlankNote(): Promise<void> {
    const title = blankTitle.trim()
    if (!mainNodeId || !title || blankBusy) return
    setBlankBusy(true)
    setError(null)
    try {
      const result = await api.createBlankNote(mainNodeId, title)
      upsertNode(result.node)
      setMain(result.node.id)
      setBlankTitle('')
      setBlankOpen(false)
      onNodeSelect?.()
    } catch {
      setError('新建空白笔记失败，请重试。')
    } finally {
      setBlankBusy(false)
    }
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
      setDeleteError(isRoot ? '删除笔记库失败，请稍后重试。' : '删除失败，请稍后重试。')
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
    <nav aria-label="笔记结构">
      <div className="tree-create-note">
        {blankOpen ? (
          <div className="tree-create-note-form">
            <input
              aria-label="空白笔记标题"
              autoFocus
              disabled={blankBusy}
              onChange={(event) => setBlankTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') { event.preventDefault(); void createBlankNote() }
                if (event.key === 'Escape') { setBlankOpen(false); setBlankTitle('') }
              }}
              placeholder="输入标题"
              value={blankTitle}
            />
            <button disabled={blankBusy || !blankTitle.trim()} onClick={() => { void createBlankNote() }} type="button">
              {blankBusy ? '新建中…' : '新建'}
            </button>
            <button aria-label="取消新建空白笔记" disabled={blankBusy} onClick={() => { setBlankOpen(false); setBlankTitle('') }} type="button"><Icon name="close" size={14} /></button>
          </div>
        ) : (
          <button className="tree-create-note-trigger" onClick={() => setBlankOpen(true)} type="button"><Icon name="plus" size={14} />新建空白笔记</button>
        )}
        <span>新笔记会放在当前选中的笔记下面</span>
      </div>
      <ul className="tree-root">
        <TreeBranch
          collapsedIds={collapsedIds}
          depth={0}
          editingId={editingId}
          editingTitle={editingTitle}
          nodeId={rootNodeId}
          onDelete={requestDelete}
          onNodeSelect={onNodeSelect}
          onRenameCancel={() => setEditingId(null)}
          onRenameChange={setEditingTitle}
          onRenameCommit={(id) => { void commitRename(id) }}
          onRenameStart={beginRename}
          onToggle={toggleNode}
          renameBusy={renameBusy}
        />
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
          <button aria-label="关闭错误提示" onClick={() => setError(null)} type="button"><Icon name="close" size={14} /></button>
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
