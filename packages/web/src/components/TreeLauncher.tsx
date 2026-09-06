import type { TreeRow } from '@vibe/shared'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import { useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'

interface PendingTreeDelete {
  tree: TreeRow
  trigger: HTMLButtonElement
}

/* 笔记库文件夹归组（Round 14）：按 tree.folder 斜杠路径建嵌套文件夹树，
   视觉/交互复用 Round 13 的目录模式（.tree-dir-header）。 */
interface FolderTreeNode {
  seg: string
  path: string
  subdirs: FolderTreeNode[]
  trees: TreeRow[]
}

interface FolderTree {
  ungrouped: TreeRow[]
  folders: FolderTreeNode[]
}

function buildFolderTree(trees: TreeRow[]): FolderTree | null {
  if (!trees.some((tree) => tree.folder?.trim())) return null
  const ungrouped: TreeRow[] = []
  const roots: FolderTreeNode[] = []
  const byPath = new Map<string, FolderTreeNode>()
  const ensureFolder = (segs: string[]): FolderTreeNode => {
    let path = ''
    let list = roots
    let current: FolderTreeNode | undefined
    for (const seg of segs) {
      path = path ? `${path}/${seg}` : seg
      current = byPath.get(path)
      if (!current) {
        current = { seg, path, subdirs: [], trees: [] }
        byPath.set(path, current)
        list.push(current)
      }
      list = current.subdirs
    }
    return current!
  }
  for (const tree of trees) {
    const folder = tree.folder?.trim()
    if (!folder) {
      ungrouped.push(tree)
      continue
    }
    ensureFolder(folder.split('/').filter(Boolean)).trees.push(tree)
  }
  const sortFolders = (folders: FolderTreeNode[]): void => {
    folders.sort((left, right) => left.seg.localeCompare(right.seg))
    for (const folder of folders) sortFolders(folder.subdirs)
  }
  sortFolders(roots)
  return { ungrouped, folders: roots }
}

/** 文件夹计数 = 递归子孙笔记库数。 */
function folderTreeCount(folder: FolderTreeNode): number {
  return folder.trees.length + folder.subdirs.reduce((total, sub) => total + folderTreeCount(sub), 0)
}

const FOLDERS_STORAGE_KEY = 'vibe-docing:tree-folders'

function loadCollapsedFolders(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDERS_STORAGE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistCollapsedFolders(collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify([...collapsed]))
  } catch { /* localStorage 不可用时静默降级 */ }
}

/* 拖拽归档（Round 15）：原生 HTML5 DnD，自定义 MIME 拒绝外部拖入；
   drop 不直接生效，一律经 ConfirmDialog 确认后才调 setTreeFolder。 */
const DND_MIME = 'application/x-vibe-item'

interface DragTree {
  id: string
  title: string
  /** 拖动前所在文件夹（null = 未分组/根）。 */
  from: string | null
  trigger: HTMLButtonElement | null
}

/** dragover 有效性：仅接受自定义 MIME；无 types 信息（jsdom）时回退到 dragTree 判定。 */
function dndAccepts(event: { dataTransfer: DataTransfer | null }, item: DragTree | null): boolean {
  const types = event.dataTransfer?.types ? Array.from(event.dataTransfer.types) : []
  if (types.length > 0 && !types.includes(DND_MIME)) return false
  return item !== null
}

interface PendingTreeDrop {
  treeId: string
  title: string
  folder: string | null
  trigger: HTMLButtonElement | null
}

export function TreeLauncher() {
  const api = useApi()
  const loadTree = useWorkbench((state) => state.loadTree)
  const setTreeTitle = useWorkbench((state) => state.setTreeTitle)
  const treeId = useWorkbench((state) => state.treeId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [trees, setTrees] = useState<TreeRow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingTreeDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsedFolders)
  // 「移入文件夹」popover 状态
  const [moveForId, setMoveForId] = useState<string | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveNewFolder, setMoveNewFolder] = useState('')
  const moveTriggerRef = useRef<HTMLButtonElement | null>(null)
  const moveMenuRef = useRef<HTMLDivElement>(null)
  // 拖拽归档（Round 15）：dragTree = 进行中的拖动；pendingDrop = 待确认的放置。
  const [dragTree, setDragTree] = useState<DragTree | null>(null)
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<PendingTreeDrop | null>(null)

  useEffect(() => {
    let active = true
    const listTrees = (api as Partial<Api>).listTrees
    if (!listTrees) return () => { active = false }
    void listTrees()
      .then((result) => { if (active) setTrees(result.trees) })
      .catch(() => { if (active) setError('笔记库列表加载失败，仍可新建。') })
    return () => { active = false }
  }, [api, treeId])

  useEffect(() => {
    const reload = () => {
      const listTrees = (api as Partial<Api>).listTrees
      if (!listTrees) return
      void listTrees().then((result) => setTrees(result.trees)).catch(() => setError('Vault 同步后刷新失败。'))
    }
    window.addEventListener('vibe:vault-synced', reload)
    return () => window.removeEventListener('vibe:vault-synced', reload)
  }, [api])

  useEffect(() => {
    if (!moveForId) return
    const close = (event: MouseEvent) => {
      if (!moveMenuRef.current?.contains(event.target as Node) && event.target !== moveTriggerRef.current) {
        setMoveForId(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [moveForId])

  const folderTree = buildFolderTree(trees)
  // 移动候选文件夹：全部 folder 路径去重排序。
  const allFolders = [...new Set(
    trees.map((tree) => tree.folder?.trim()).filter((folder): folder is string => !!folder),
  )].sort((left, right) => left.localeCompare(right))

  function toggleFolder(path: string): void {
    setCollapsedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      persistCollapsedFolders(next)
      return next
    })
  }

  async function create(): Promise<void> {
    const value = title.trim()
    if (!value) return
    // 快捷语法：「文件夹/名称」——最后一段为库名，前面为文件夹路径。
    const slash = value.lastIndexOf('/')
    const folder = slash > 0 ? value.slice(0, slash).trim() || null : null
    const name = (slash > 0 ? value.slice(slash + 1) : value).trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.createTree(name)
      let tree = result.tree
      if (folder) {
        try {
          const res = await api.setTreeFolder(tree.id, folder)
          tree = res.tree
        } catch {
          useWorkbench.getState().setToast('文件夹设置失败，笔记库已创建，可稍后通过「移入文件夹」调整。')
        }
      }
      loadTree({
        nodes: [result.rootNode],
        rootNodeId: result.rootNode.id,
        treeId: tree.id,
        treeTitle: tree.title,
      })
      setTrees((current) => [tree, ...current.filter((item) => item.id !== tree.id)])
      setTitle('')
    } catch {
      setError('新建笔记库失败，请检查本地服务。')
    } finally {
      setBusy(false)
    }
  }

  async function open(tree: TreeRow): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.getTree(tree.id)
      const rootNodeId = result.tree.root_node_id
      if (!rootNodeId) throw new Error('tree has no root')
      loadTree({
        annotations: result.annotations,
        merges: result.merges,
        nodes: result.nodes,
        rootNodeId,
        treeId: result.tree.id,
        treeTitle: result.tree.title,
      })
    } catch {
      setError('打开笔记库失败。')
    } finally {
      setBusy(false)
    }
  }

  async function remove(tree: TreeRow): Promise<void> {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.deleteTree(tree.id)
      setTrees((current) => current.filter((item) => item.id !== tree.id))
      if (useWorkbench.getState().treeId === tree.id) {
        useWorkbench.getState().reset()
      }
      setPendingDelete(null)
    } catch {
      setDeleteError('删除笔记库失败，请稍后重试。')
    } finally {
      setDeleteBusy(false)
    }
  }

  function beginRename(tree: TreeRow): void {
    setEditingId(tree.id)
    setEditingTitle(tree.title)
  }

  async function commitRename(tree: TreeRow): Promise<void> {
    const value = editingTitle.trim()
    setEditingId(null)
    if (!value || value === tree.title) return
    try {
      const result = await api.renameTree(tree.id, value)
      setTrees((current) => current.map((item) => (item.id === tree.id ? result.tree : item)))
      if (useWorkbench.getState().treeId === tree.id) setTreeTitle(result.tree.title)
    } catch {
      setError('重命名失败，请稍后重试。')
    }
  }

  async function moveTree(tree: TreeRow, folder: string | null): Promise<void> {
    if (moveBusy) return
    const current = tree.folder?.trim() || null
    if (folder === current) {
      setMoveForId(null)
      return
    }
    setMoveBusy(true)
    try {
      const result = await api.setTreeFolder(tree.id, folder)
      setTrees((currentTrees) => currentTrees.map((item) => (item.id === tree.id ? result.tree : item)))
      setMoveForId(null)
      setMoveNewFolder('')
    } catch {
      useWorkbench.getState().setToast('移动笔记库失败，请重试。')
    } finally {
      setMoveBusy(false)
    }
  }

  /** drop 不直接生效：校验后进入确认弹窗。path '' = 未分组（移出文件夹）。 */
  function handleFolderDrop(path: string): void {
    if (!dragTree) return
    const folder = path || null
    if (dragTree.from === folder) return
    setPendingDrop({ folder, title: dragTree.title, treeId: dragTree.id, trigger: dragTree.trigger })
    setDragTree(null)
    setDropTargetFolder(null)
  }

  function endDrag(): void {
    setDragTree(null)
    setDropTargetFolder(null)
  }

  async function confirmDrop(): Promise<void> {
    if (!pendingDrop) return
    const tree = trees.find((item) => item.id === pendingDrop.treeId)
    const folder = pendingDrop.folder
    setPendingDrop(null)
    if (!tree) return
    await moveTree(tree, folder)
  }

  // 轻量键盘模型：↑↓/Home/End 在可见行（文件夹头 + 库行）间移动，←→ 折叠/展开文件夹。
  function handleListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>): void {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-launch-row]')
    if (!row) return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-launch-row]'))
    const index = rows.indexOf(row)
    if (index < 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      rows[event.key === 'ArrowDown' ? index + 1 : index - 1]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      ;(event.key === 'Home' ? rows[0] : rows[rows.length - 1])?.focus()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const path = row.dataset.folderPath
      if (path === undefined) return
      event.preventDefault()
      const collapsed = collapsedFolders.has(path)
      if (event.key === 'ArrowLeft' && !collapsed) toggleFolder(path)
      if (event.key === 'ArrowRight' && collapsed) toggleFolder(path)
    }
  }

  function renderMoveMenu(tree: TreeRow) {
    const current = tree.folder?.trim() || null
    return (
      <div
        aria-label={`移动“${tree.title}”到文件夹`}
        className="tree-move-menu"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setMoveForId(null)
          moveTriggerRef.current?.focus()
        }}
        ref={moveMenuRef}
        role="menu"
      >
        {allFolders.filter((folder) => folder !== current).map((folder) => (
          <button disabled={moveBusy} key={folder} onClick={() => { void moveTree(tree, folder) }} role="menuitem" type="button">
            <Icon name="folder" size={12} />{folder}
          </button>
        ))}
        <div className="tree-move-new">
          <input
            aria-label="新文件夹名"
            disabled={moveBusy}
            onChange={(event) => setMoveNewFolder(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && moveNewFolder.trim()) {
                event.preventDefault()
                void moveTree(tree, moveNewFolder.trim())
              }
            }}
            placeholder="新文件夹…"
            type="text"
            value={moveNewFolder}
          />
          <button
            disabled={moveBusy || !moveNewFolder.trim()}
            onClick={() => { void moveTree(tree, moveNewFolder.trim()) }}
            type="button"
          >
            移入
          </button>
        </div>
        {current !== null && (
          <button disabled={moveBusy} onClick={() => { void moveTree(tree, null) }} role="menuitem" type="button">
            移出文件夹
          </button>
        )}
      </div>
    )
  }

  function renderTreeItem(tree: TreeRow) {
    return (
      <li className={`tree-item${dragTree?.id === tree.id ? ' is-dragging' : ''}`} key={tree.id}>
        {editingId === tree.id ? (
          <input
            aria-label="重命名笔记库"
            autoFocus
            onBlur={() => { void commitRename(tree) }}
            onChange={(event) => setEditingTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { event.preventDefault(); void commitRename(tree) }
              if (event.key === 'Escape') setEditingId(null)
            }}
            value={editingTitle}
          />
        ) : (
          <>
            <button
              aria-current={treeId === tree.id ? 'page' : undefined}
              className="tree-item-open"
              data-launch-row
              disabled={busy}
              draggable={!busy}
              onClick={() => { void open(tree) }}
              onDragEnd={endDrag}
              onDragStart={(event) => {
                event.dataTransfer?.setData?.(DND_MIME, JSON.stringify({ id: tree.id, kind: 'tree' }))
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                setDragTree({
                  from: tree.folder?.trim() || null,
                  id: tree.id,
                  title: tree.title,
                  trigger: event.currentTarget,
                })
              }}
              title={tree.title}
              type="button"
            >
              {tree.title}
            </button>
            <button
              aria-label={`重命名“${tree.title}”`}
              className="tree-item-action"
              onClick={() => beginRename(tree)}
              title="重命名"
              type="button"
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              aria-expanded={moveForId === tree.id}
              aria-haspopup="menu"
              aria-label={`移动“${tree.title}”到文件夹`}
              className="tree-item-action tree-item-move"
              disabled={moveBusy && moveForId === tree.id}
              onClick={(event) => {
                moveTriggerRef.current = event.currentTarget
                setMoveForId((current) => (current === tree.id ? null : tree.id))
              }}
              title="移入文件夹"
              type="button"
            >
              <Icon name="folder" size={14} />
            </button>
            <button
              aria-label={`删除“${tree.title}”`}
              className="tree-item-action"
              onClick={(event) => {
                setDeleteError(null)
                setPendingDelete({ tree, trigger: event.currentTarget })
              }}
              title="移到回收站"
              type="button"
            >
              <Icon name="trash" size={14} />
            </button>
            {moveForId === tree.id && renderMoveMenu(tree)}
          </>
        )}
      </li>
    )
  }

  function renderFolder(folder: FolderTreeNode) {
    const expanded = !collapsedFolders.has(folder.path)
    const label = folder.seg === '' ? '未分组' : folder.seg
    // 有效放置目标：目标文件夹 ≠ 当前所在文件夹（原位不亮、drop 无动作）。
    const dropValid = dragTree !== null && dragTree.from !== (folder.path || null)
    return (
      <li className="tree-folder" key={folder.path || '__ungrouped__'}>
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}文件夹“${label}”`}
          className={`tree-dir-header${dropTargetFolder === folder.path && dropValid ? ' is-drop-target' : ''}`}
          data-folder-path={folder.path}
          data-launch-row
          onClick={() => toggleFolder(folder.path)}
          onDragLeave={() => { if (dropTargetFolder === folder.path) setDropTargetFolder(null) }}
          onDragOver={(event) => {
            if (!dndAccepts(event, dragTree) || !dropValid) return
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
            if (dropTargetFolder !== folder.path) setDropTargetFolder(folder.path)
          }}
          onDrop={(event) => {
            if (!dndAccepts(event, dragTree)) return
            event.preventDefault()
            setDropTargetFolder(null)
            if (dropValid) handleFolderDrop(folder.path)
          }}
          type="button"
        >
          <span aria-hidden="true" className="tree-node-toggle"><span><Icon name="chevron-right" size={12} /></span></span>
          <Icon name="folder" size={12} />
          <span className="tree-dir-name">{label}</span>
          <span className="tree-dir-count">{folderTreeCount(folder)}</span>
        </button>
        {expanded && (
          <ul className="tree-folder-children">
            {folder.subdirs.map((sub) => renderFolder(sub))}
            {folder.trees.map((tree) => renderTreeItem(tree))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <section className="tree-launcher" aria-label="笔记库入口">
      <div className="new-tree-row">
        <input
          aria-label="新建笔记库标题"
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Ignore Enter that only confirms an IME candidate (e.g. Pinyin),
            // and Enter with an empty title — both are accidental creates.
            if (event.nativeEvent.isComposing) return
            if (!title.trim()) return
            event.preventDefault()
            void create()
          }}
          placeholder="输入笔记库名称，可用 文件夹/名称"
          value={title}
        />
        <button disabled={busy || !title.trim()} onClick={() => { void create() }} title={title.trim() ? undefined : '请先输入名称'} type="button">新建笔记库</button>
      </div>
      {trees.length > 0 && (
        <ul aria-label="已有笔记库" onKeyDown={handleListKeyDown}>
          {folderTree
            ? (
              <>
                {folderTree.ungrouped.length > 0 && renderFolder({ seg: '', path: '', subdirs: [], trees: folderTree.ungrouped })}
                {folderTree.folders.map((folder) => renderFolder(folder))}
              </>
            )
            : trees.map((tree) => renderTreeItem(tree))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      {pendingDelete && (
        <ConfirmDialog
          busy={deleteBusy}
          error={deleteError}
          message={`将删除笔记库“${pendingDelete.tree.title}”，可在回收站恢复。`}
          onCancel={() => {
            setDeleteError(null)
            setPendingDelete(null)
          }}
          onConfirm={() => remove(pendingDelete.tree)}
          returnFocusTo={pendingDelete.trigger}
        />
      )}
      {pendingDrop && (
        <ConfirmDialog
          busy={moveBusy}
          busyLabel="移动中…"
          confirmLabel="移入"
          message={pendingDrop.folder === null
            ? `将「${pendingDrop.title}」移出文件夹？`
            : `将「${pendingDrop.title}」移入文件夹「${pendingDrop.folder}」？`}
          onCancel={() => setPendingDrop(null)}
          onConfirm={confirmDrop}
          returnFocusTo={pendingDrop.trigger}
          title="移动笔记库"
        />
      )}
    </section>
  )
}
