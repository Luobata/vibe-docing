import type { TreeRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import { useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'

interface PendingTreeDelete {
  tree: TreeRow
  trigger: HTMLButtonElement
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

  async function create(): Promise<void> {
    const value = title.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.createTree(value)
      loadTree({
        nodes: [result.rootNode],
        rootNodeId: result.rootNode.id,
        treeId: result.tree.id,
        treeTitle: result.tree.title,
      })
      setTrees((current) => [result.tree, ...current.filter((tree) => tree.id !== result.tree.id)])
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

  return (
    <section className="tree-launcher" aria-label="笔记库入口">
      <div className="new-tree-row">
        <input
          aria-label="new-tree-title"
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
          placeholder="输入笔记库名称"
          value={title}
        />
        <button disabled={busy || !title.trim()} onClick={() => { void create() }} title={title.trim() ? undefined : '请先输入名称'} type="button">新建笔记库</button>
      </div>
      {trees.length > 0 && (
        <ul aria-label="已有笔记库">
          {trees.map((tree) => (
            <li className="tree-item" key={tree.id}>
              {editingId === tree.id ? (
                <input
                  aria-label="rename-tree-input"
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
                    disabled={busy}
                    onClick={() => { void open(tree) }}
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
                    <Icon name="edit" size={13} />
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
                    <Icon name="trash" size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
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
    </section>
  )
}
