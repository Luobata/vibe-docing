import type { NodeRow } from '@vibe/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api/context'
import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'
import { formatRelativeTime } from './format-time'
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

/* 目录分组（Round 12 · ① → Round 13 嵌套强化）：按 dirname(file_path) 把同层子节点
   组织成嵌套目录树（a/b 与 a/c 共享父目录 a）。仅当本层存在带目录的节点时启用分组，
   否则保持平铺（兼容无 file_path 的树）。
   内部命名空间剥离：vault 默认落盘前缀 `Vibe Derived` 及其下的树名层是存储约定，
   不代表用户组织意图——分组与移动候选一律忽略，只有用户显式移动过的目录才生效。 */
const INTERNAL_VAULT_ROOT = 'Vibe Derived'

function dirOf(node: NodeRow, treeTitle: string | null): string {
  const path = node.file_path ?? ''
  const index = path.lastIndexOf('/')
  let dir = index > 0 ? path.slice(0, index) : ''
  if (!dir) return ''
  const segments = dir.split('/')
  if (segments[0] === INTERNAL_VAULT_ROOT) {
    segments.shift()
    if (treeTitle && segments[0] === treeTitle) segments.shift()
  }
  return segments.join('/')
}

interface DirTreeNode {
  /** 当前层段名（目录头只显示它，不显示全路径）。 */
  seg: string
  /** 全路径，折叠持久化键的组成部分。 */
  path: string
  subdirs: DirTreeNode[]
  notes: NodeRow[]
}

interface DirTree {
  ungrouped: NodeRow[]
  dirs: DirTreeNode[]
}

function buildDirTree(children: NodeRow[], treeTitle: string | null): DirTree | null {
  if (!children.some((child) => dirOf(child, treeTitle) !== '')) return null
  const ungrouped: NodeRow[] = []
  const roots: DirTreeNode[] = []
  const byPath = new Map<string, DirTreeNode>()
  const ensureDir = (segs: string[]): DirTreeNode => {
    let path = ''
    let list = roots
    let current: DirTreeNode | undefined
    for (const seg of segs) {
      path = path ? `${path}/${seg}` : seg
      current = byPath.get(path)
      if (!current) {
        current = { seg, path, subdirs: [], notes: [] }
        byPath.set(path, current)
        list.push(current)
      }
      list = current.subdirs
    }
    return current!
  }
  for (const child of children) {
    const dir = dirOf(child, treeTitle)
    if (!dir) {
      ungrouped.push(child)
      continue
    }
    ensureDir(dir.split('/')).notes.push(child)
  }
  const sortDirs = (dirs: DirTreeNode[]): void => {
    dirs.sort((left, right) => left.seg.localeCompare(right.seg))
    for (const dir of dirs) sortDirs(dir.subdirs)
  }
  sortDirs(roots)
  return { ungrouped, dirs: roots }
}

/** 目录节点计数 = 递归子孙笔记数。 */
function dirNoteCount(dir: DirTreeNode): number {
  return dir.notes.length + dir.subdirs.reduce((total, sub) => total + dirNoteCount(sub), 0)
}

function dirRowId(ownerId: string, dir: string): string {
  return `dir:${ownerId}/${dir}`
}

/* 拖拽归档（Round 15）：原生 HTML5 DnD，自定义 MIME 拒绝外部拖入；
   drop 不直接生效，一律经 ConfirmDialog 确认后才调 API。 */
const DND_MIME = 'application/x-vibe-item'

interface DragItem {
  kind: 'node' | 'tree'
  id: string
  title: string
  /** 拖动前的所在目录（剥离命名空间后的用户目录；'' = 根/未分组）。 */
  from: string
  trigger: HTMLButtonElement | null
}

/** dragover 有效性：仅接受同类型拖入；无 types 信息（jsdom）时回退到 dragItem 判定。 */
function dndAccepts(event: { dataTransfer: DataTransfer | null }, item: DragItem | null): boolean {
  const types = event.dataTransfer?.types ? Array.from(event.dataTransfer.types) : []
  if (types.length > 0 && !types.includes(DND_MIME)) return false
  return item !== null
}

const DIRS_STORAGE_KEY = 'vibe-docing:tree-dirs'

function loadCollapsedDirs(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(DIRS_STORAGE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistCollapsedDirs(collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DIRS_STORAGE_KEY, JSON.stringify([...collapsed]))
  } catch { /* localStorage 不可用时静默降级 */ }
}

interface TreeBranchProps {
  activeRowId: string | null
  collapsedDirs: ReadonlySet<string>
  collapsedIds: ReadonlySet<string>
  depth: number
  dragItem: DragItem | null
  dropTargetKey: string | null
  editingId: string | null
  editingTitle: string
  nodeId: string
  onDelete(id: string, trigger: HTMLButtonElement): void
  onDirDrop(dir: string): void
  onDragEnd(): void
  onDragStartNode(item: DragItem): void
  onDropTargetChange(key: string | null): void
  onNodeSelect?(): void
  onRenameCancel(): void
  onRenameChange(value: string): void
  onRenameCommit(id: string): void
  onRenameStart(id: string): void
  onRowFocus(id: string): void
  onToggle(id: string): void
  onToggleDir(key: string): void
  renameBusy: boolean
}

function TreeBranch({ activeRowId, collapsedDirs, collapsedIds, depth, dragItem, dropTargetKey, editingId, editingTitle, nodeId, onDelete, onDirDrop, onDragEnd, onDragStartNode, onDropTargetChange, onNodeSelect, onRenameCancel, onRenameChange, onRenameCommit, onRenameStart, onRowFocus, onToggle, onToggleDir, renameBusy }: TreeBranchProps) {
  const api = useApi()
  const nodesById = useWorkbench((state) => state.nodesById)
  const treeTitle = useWorkbench((state) => state.treeTitle)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const setMain = useWorkbench((state) => state.setMain)
  const unreadNodeIds = useWorkbench((state) => state.unreadNodeIds)
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
  // 「移动到目录」popover 状态（仅非根节点渲染入口）。
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveNewDir, setMoveNewDir] = useState('')
  const moveTriggerRef = useRef<HTMLButtonElement>(null)
  const moveMenuRef = useRef<HTMLDivElement>(null)
  const node = nodesById[nodeId]
  useEffect(() => {
    if (!moveOpen) return
    const close = (event: MouseEvent) => {
      if (!moveMenuRef.current?.contains(event.target as Node) && event.target !== moveTriggerRef.current) {
        setMoveOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [moveOpen])
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

  const rowActive = activeRowId === node.id
  // 同层目录分组（嵌套目录树）：有任意子节点带目录时启用。
  const dirTree = buildDirTree(children, treeTitle)
  // 移动候选目录：全树 dirname 去重（不含当前所在目录与根；内部命名空间已剥离）。
  const currentDir = dirOf(node, treeTitle)
  const allDirs = [...new Set(
    Object.values(nodesById)
      .filter((candidate) => candidate.is_deleted === 0)
      .map((candidate) => dirOf(candidate, treeTitle))
      .filter((dir) => dir !== ''),
  )].sort((left, right) => left.localeCompare(right))

  async function moveTo(directory: string): Promise<void> {
    if (moveBusy || !node) return
    if (directory === currentDir) {
      setMoveOpen(false)
      return
    }
    setMoveBusy(true)
    try {
      const result = await api.moveNode(node.id, directory)
      upsertNode(result.node)
      setMoveOpen(false)
      setMoveNewDir('')
    } catch {
      useWorkbench.getState().setToast('移动笔记失败，请重试。')
    } finally {
      setMoveBusy(false)
    }
  }

  function closeMoveMenu(restoreFocus = false): void {
    setMoveOpen(false)
    if (restoreFocus) moveTriggerRef.current?.focus()
  }

  return (
    <li className="tree-branch" data-depth={depth}>
      <div
        className={`tree-node-row${dragItem?.kind === 'node' && dragItem.id === node.id ? ' is-dragging' : ''}`}
        data-generating={generating || undefined}
        data-unread={unread || undefined}
      >
        {children.length > 0 ? (
          <button
            aria-label={`${expanded ? '收起' : '展开'}“${accessibleLabel}”`}
            aria-expanded={expanded}
            className="tree-node-toggle"
            onClick={() => onToggle(node.id)}
            tabIndex={-1}
            type="button"
          >
            <span aria-hidden="true"><Icon name="chevron-right" size={12} /></span>
          </button>
        ) : (
          // 叶子节点的装饰圆点：纯装饰 span，不占 a11y 树。
          <span aria-hidden="true" className="tree-node-toggle"><span /></span>
        )}
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
            data-node-id={node.id}
            data-row-id={node.id}
            draggable={!!node.parent_id && editingId !== node.id}
            onClick={() => { setMain(node.id); onNodeSelect?.() }}
            onDragEnd={onDragEnd}
            onDragStart={(event) => {
              event.dataTransfer?.setData?.(DND_MIME, JSON.stringify({ id: node.id, kind: 'node' }))
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
              onDragStartNode({
                from: currentDir,
                id: node.id,
                kind: 'node',
                title: displayLabel,
                trigger: event.currentTarget,
              })
            }}
            onFocus={() => onRowFocus(node.id)}
            tabIndex={rowActive ? 0 : -1}
            title={accessibleLabel + (node.created_at && node.updated_at
              ? `\n创建于 ${formatRelativeTime(node.created_at)} · 更新于 ${formatRelativeTime(node.updated_at)}`
              : '')}
            type="button"
          >
            <span aria-hidden="true" className="tree-node-kind"><Icon name={node.parent_id ? 'note' : 'doc'} size={12} /></span>
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
            tabIndex={rowActive ? 0 : -1}
            title="仅修改标题，不会重新生成正文"
            type="button"
          >
            <Icon name="edit" size={14} />
          </button>
        )}
        {node.parent_id && editingId !== node.id && (
          <button
            aria-expanded={moveOpen}
            aria-haspopup="menu"
            aria-label={`移动“${displayLabel}”到目录`}
            className="tree-node-action tree-node-move"
            disabled={generating || moveBusy}
            onClick={() => setMoveOpen((open) => !open)}
            ref={moveTriggerRef}
            tabIndex={rowActive ? 0 : -1}
            title="移动到目录"
            type="button"
          >
            <Icon name="folder" size={14} />
          </button>
        )}
        {moveOpen && (
          <div
            aria-label={`移动“${displayLabel}”到目录`}
            className="tree-move-menu"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              closeMoveMenu(true)
            }}
            ref={moveMenuRef}
            role="menu"
          >
            {allDirs.filter((dir) => dir !== currentDir).map((dir) => (
              <button disabled={moveBusy} key={dir} onClick={() => { void moveTo(dir) }} role="menuitem" type="button">
                <Icon name="folder" size={12} />{dir}
              </button>
            ))}
            <div className="tree-move-new">
              <input
                aria-label="新目录名"
                disabled={moveBusy}
                onChange={(event) => setMoveNewDir(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter' && moveNewDir.trim()) {
                    event.preventDefault()
                    void moveTo(moveNewDir.trim())
                  }
                }}
                placeholder="新目录…"
                type="text"
                value={moveNewDir}
              />
              <button
                disabled={moveBusy || !moveNewDir.trim()}
                onClick={() => { void moveTo(moveNewDir.trim()) }}
                type="button"
              >
                移动
              </button>
            </div>
            {currentDir !== '' && (
              <button disabled={moveBusy} onClick={() => { void moveTo('') }} role="menuitem" type="button">
                移到根目录
              </button>
            )}
          </div>
        )}
        <button
          aria-label={`删除“${nodeTitle(node, treeTitle)}”`}
          className="tree-node-action tree-node-delete"
          disabled={renameBusy && editingId === node.id}
          onClick={(event) => onDelete(node.id, event.currentTarget)}
          tabIndex={rowActive ? 0 : -1}
          title="移到回收站"
          type="button"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      {expanded && (
        <ul>
          {dirTree
            ? (
              <>
                {dirTree.ungrouped.length > 0 && (
                  <DirBranch
                    activeRowId={activeRowId}
                    collapsedDirs={collapsedDirs}
                    collapsedIds={collapsedIds}
                    depth={depth + 1}
                    dirNode={{ seg: '', path: '', subdirs: [], notes: dirTree.ungrouped }}
                    dragItem={dragItem}
                    dropTargetKey={dropTargetKey}
                    editingId={editingId}
                    editingTitle={editingTitle}
                    onDelete={onDelete}
                    onDirDrop={onDirDrop}
                    onDragEnd={onDragEnd}
                    onDragStartNode={onDragStartNode}
                    onDropTargetChange={onDropTargetChange}
                    onNodeSelect={onNodeSelect}
                    onRenameCancel={onRenameCancel}
                    onRenameChange={onRenameChange}
                    onRenameCommit={onRenameCommit}
                    onRenameStart={onRenameStart}
                    onRowFocus={onRowFocus}
                    onToggle={onToggle}
                    onToggleDir={onToggleDir}
                    ownerId={node.id}
                    renameBusy={renameBusy}
                  />
                )}
                {dirTree.dirs.map((dirNode) => (
                  <DirBranch
                    activeRowId={activeRowId}
                    collapsedDirs={collapsedDirs}
                    collapsedIds={collapsedIds}
                    depth={depth + 1}
                    dirNode={dirNode}
                    dragItem={dragItem}
                    dropTargetKey={dropTargetKey}
                    editingId={editingId}
                    editingTitle={editingTitle}
                    key={dirRowId(node.id, dirNode.path)}
                    onDelete={onDelete}
                    onDirDrop={onDirDrop}
                    onDragEnd={onDragEnd}
                    onDragStartNode={onDragStartNode}
                    onDropTargetChange={onDropTargetChange}
                    onNodeSelect={onNodeSelect}
                    onRenameCancel={onRenameCancel}
                    onRenameChange={onRenameChange}
                    onRenameCommit={onRenameCommit}
                    onRenameStart={onRenameStart}
                    onRowFocus={onRowFocus}
                    onToggle={onToggle}
                    onToggleDir={onToggleDir}
                    ownerId={node.id}
                    renameBusy={renameBusy}
                  />
                ))}
              </>
            )
            : children.map((child) => (
                <TreeBranch
                  activeRowId={activeRowId}
                  collapsedDirs={collapsedDirs}
                  collapsedIds={collapsedIds}
                  depth={depth + 1}
                  dragItem={dragItem}
                  dropTargetKey={dropTargetKey}
                  editingId={editingId}
                  editingTitle={editingTitle}
                  key={child.id}
                  nodeId={child.id}
                  onDelete={onDelete}
                  onDirDrop={onDirDrop}
                  onDragEnd={onDragEnd}
                  onDragStartNode={onDragStartNode}
                  onDropTargetChange={onDropTargetChange}
                  onNodeSelect={onNodeSelect}
                  onRenameCancel={onRenameCancel}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameStart={onRenameStart}
                  onRowFocus={onRowFocus}
                  onToggle={onToggle}
                  onToggleDir={onToggleDir}
                  renameBusy={renameBusy}
                />
              ))}
        </ul>
      )}
    </li>
  )
}

/** 嵌套目录分支：目录头（段名 + 递归计数）+ 子目录 + 组内笔记行；兼作 DnD 放置目标。 */
function DirBranch({ activeRowId, collapsedDirs, collapsedIds, depth, dirNode, dragItem, dropTargetKey, editingId, editingTitle, onDelete, onDirDrop, onDragEnd, onDragStartNode, onDropTargetChange, onNodeSelect, onRenameCancel, onRenameChange, onRenameCommit, onRenameStart, onRowFocus, onToggle, onToggleDir, ownerId, renameBusy }: Omit<TreeBranchProps, 'nodeId'> & {
  dirNode: DirTreeNode
  ownerId: string
}) {
  const key = dirRowId(ownerId, dirNode.path)
  const expanded = !collapsedDirs.has(key)
  const label = dirNode.seg === '' ? '未分组' : dirNode.seg
  // 有效放置目标：笔记拖入且目标目录 ≠ 当前所在目录（原位不亮、drop 无动作）。
  const dropValid = dragItem?.kind === 'node' && dragItem.from !== dirNode.path
  const childProps = {
    activeRowId, collapsedDirs, collapsedIds, dragItem, dropTargetKey, editingId, editingTitle, renameBusy,
    onDelete, onDirDrop, onDragEnd, onDragStartNode, onDropTargetChange, onNodeSelect,
    onRenameCancel, onRenameChange, onRenameCommit, onRenameStart, onRowFocus, onToggle, onToggleDir,
  }
  return (
    <li className="tree-branch tree-dir" data-depth={depth}>
      <div className="tree-node-row tree-dir-row">
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}目录“${label}”`}
          className={`tree-dir-header${dropTargetKey === key && dropValid ? ' is-drop-target' : ''}`}
          data-row-id={key}
          onClick={() => onToggleDir(key)}
          onDragLeave={() => { if (dropTargetKey === key) onDropTargetChange(null) }}
          onDragOver={(event) => {
            if (!dndAccepts(event, dragItem) || !dropValid) return
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
            if (dropTargetKey !== key) onDropTargetChange(key)
          }}
          onDrop={(event) => {
            if (!dndAccepts(event, dragItem)) return
            event.preventDefault()
            onDropTargetChange(null)
            if (dropValid) onDirDrop(dirNode.path)
          }}
          onFocus={() => onRowFocus(key)}
          tabIndex={activeRowId === key ? 0 : -1}
          type="button"
        >
          <span aria-hidden="true" className="tree-node-toggle"><span><Icon name="chevron-right" size={12} /></span></span>
          <Icon name="folder" size={12} />
          <span className="tree-dir-name">{label}</span>
          <span className="tree-dir-count">{dirNoteCount(dirNode)}</span>
        </button>
      </div>
      {expanded && (
        <ul>
          {dirNode.subdirs.map((sub) => (
            <DirBranch {...childProps} depth={depth + 1} dirNode={sub} key={dirRowId(ownerId, sub.path)} ownerId={ownerId} />
          ))}
          {dirNode.notes.map((child) => (
            <TreeBranch {...childProps} depth={depth + 1} key={child.id} nodeId={child.id} />
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
  // 目录组折叠状态（localStorage 持久化，键 = dir:<ownerId>/<dir>）。
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(loadCollapsedDirs)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [blankTitle, setBlankTitle] = useState('')
  const [blankOpen, setBlankOpen] = useState(false)
  const [blankBusy, setBlankBusy] = useState(false)
  // 拖拽归档（Round 15）：dragItem = 进行中的拖动；pendingMove = 待确认的移动。
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<{ id: string; title: string; dir: string; trigger: HTMLButtonElement | null } | null>(null)
  const [moveDnDBusy, setMoveDnDBusy] = useState(false)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navRef = useRef<HTMLElement>(null)
  // roving tabindex：整个树恰一个 Tab 停靠点（activeRowId 所在行）。
  const [focusRowId, setFocusRowId] = useState<string | null>(null)

  // 可见行扁平列表（遵循折叠态与删除态），键盘导航的唯一数据源。
  // 目录头也是一种行（kind: 'dir'），与节点行走同一套 roving 模型。
  const visibleRows = useMemo(() => {
    const rows: Array<{ id: string; parentId: string | null; hasChildren: boolean; expanded: boolean; kind: 'node' | 'dir' }> = []
    const walk = (id: string, parentId: string | null): void => {
      const current = nodesById[id]
      if (!current || current.is_deleted === 1) return
      const children = Object.values(nodesById)
        .filter((candidate) => candidate.parent_id === id && candidate.is_deleted === 0)
        .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
      const expanded = children.length > 0 && !collapsedIds.has(id)
      rows.push({ id, parentId, hasChildren: children.length > 0, expanded, kind: 'node' })
      if (!expanded) return
      const dirTree = buildDirTree(children, treeTitle)
      if (!dirTree) {
        for (const child of children) walk(child.id, id)
        return
      }
      // 目录头行的子行 = 子目录行 + 组内笔记行（与渲染顺序一致）。
      const walkDir = (dirNode: DirTreeNode, parentRowId: string): void => {
        const key = dirRowId(id, dirNode.path)
        const dirExpanded = !collapsedDirs.has(key)
        rows.push({ id: key, parentId: parentRowId, hasChildren: true, expanded: dirExpanded, kind: 'dir' })
        if (!dirExpanded) return
        for (const sub of dirNode.subdirs) walkDir(sub, key)
        for (const note of dirNode.notes) walk(note.id, key)
      }
      if (dirTree.ungrouped.length > 0) {
        walkDir({ seg: '', path: '', subdirs: [], notes: dirTree.ungrouped }, id)
      }
      for (const dir of dirTree.dirs) walkDir(dir, id)
    }
    if (rootNodeId) walk(rootNodeId, null)
    return rows
  }, [nodesById, collapsedIds, collapsedDirs, rootNodeId])

  const visibleIds = new Set(visibleRows.map((row) => row.id))
  const activeRowId = focusRowId && visibleIds.has(focusRowId)
    ? focusRowId
    : (mainNodeId && visibleIds.has(mainNodeId) ? mainNodeId : visibleRows[0]?.id ?? null)

  function focusRow(id: string): void {
    setFocusRowId(id)
    navRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus()
  }

  function toggleDir(key: string): void {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      persistCollapsedDirs(next)
      return next
    })
  }

  function handleTreeKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const target = event.target as HTMLElement
    // 行内动作（重命名/移动/删除）：Escape 退回行主按钮。
    const action = target.closest<HTMLElement>('.tree-node-action')
    if (action) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      action.closest('.tree-node-row')?.querySelector<HTMLElement>('.tree-node-main')?.focus()
      return
    }
    const rowElement = target.closest<HTMLElement>('[data-row-id]')
    const id = rowElement?.dataset.rowId
    if (!rowElement || !id) return
    const index = visibleRows.findIndex((row) => row.id === id)
    if (index < 0) return
    const row = visibleRows[index]
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = visibleRows[event.key === 'ArrowDown' ? index + 1 : index - 1]
      if (next) focusRow(next.id)
    } else if (event.key === 'ArrowRight') {
      if (!row.hasChildren) return
      event.preventDefault()
      if (!row.expanded) {
        if (row.kind === 'dir') toggleDir(id)
        else toggleNode(id)
      } else {
        const child = visibleRows[index + 1]
        if (child && child.parentId === id) focusRow(child.id)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (row.expanded) {
        if (row.kind === 'dir') toggleDir(id)
        else toggleNode(id)
      } else if (row.parentId) focusRow(row.parentId)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const targetRow = event.key === 'Home' ? visibleRows[0] : visibleRows[visibleRows.length - 1]
      if (targetRow) focusRow(targetRow.id)
    } else if (event.key === 'Enter') {
      // jsdom 无 button 激活行为；preventDefault 避免浏览器双触发。
      event.preventDefault()
      if (row.kind === 'dir') toggleDir(id)
      else rowElement.click()
    }
  }

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

  /** drop 不直接生效：校验后进入确认弹窗。 */
  function handleDirDrop(dir: string): void {
    if (!dragItem || dragItem.kind !== 'node') return
    if (dragItem.from === dir) return
    setPendingMove({ dir, id: dragItem.id, title: dragItem.title, trigger: dragItem.trigger })
    setDragItem(null)
    setDropTargetKey(null)
  }

  function endDrag(): void {
    setDragItem(null)
    setDropTargetKey(null)
  }

  async function confirmMove(): Promise<void> {
    if (!pendingMove || moveDnDBusy) return
    const { id, dir } = pendingMove
    setMoveDnDBusy(true)
    try {
      const result = await api.moveNode(id, dir)
      upsertNode(result.node)
      setPendingMove(null)
    } catch {
      useWorkbench.getState().setToast('移动笔记失败，请重试。')
      setPendingMove(null)
    } finally {
      setMoveDnDBusy(false)
    }
  }

  if (!rootNodeId) return <p className="empty-state">暂无内容</p>
  return (
    <nav aria-label="笔记结构" onKeyDown={handleTreeKeyDown} ref={navRef}>
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
          activeRowId={activeRowId}
          collapsedDirs={collapsedDirs}
          collapsedIds={collapsedIds}
          depth={0}
          dragItem={dragItem}
          dropTargetKey={dropTargetKey}
          editingId={editingId}
          editingTitle={editingTitle}
          nodeId={rootNodeId}
          onDelete={requestDelete}
          onDirDrop={handleDirDrop}
          onDragEnd={endDrag}
          onDragStartNode={setDragItem}
          onDropTargetChange={setDropTargetKey}
          onNodeSelect={onNodeSelect}
          onRenameCancel={() => setEditingId(null)}
          onRenameChange={setEditingTitle}
          onRenameCommit={(id) => { void commitRename(id) }}
          onRenameStart={beginRename}
          onRowFocus={setFocusRowId}
          onToggle={toggleNode}
          onToggleDir={toggleDir}
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
      {pendingMove && (
        <ConfirmDialog
          busy={moveDnDBusy}
          busyLabel="移动中…"
          confirmLabel="移入"
          message={pendingMove.dir === ''
            ? `将「${pendingMove.title}」移到根目录？`
            : `将「${pendingMove.title}」移入文件夹「${pendingMove.dir}」？`}
          onCancel={() => setPendingMove(null)}
          onConfirm={confirmMove}
          returnFocusTo={pendingMove.trigger}
          title="移动笔记"
        />
      )}
    </nav>
  )
}
