import type { TreeRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import { useWorkbench } from '../state/workbench-store'

export function TreeLauncher() {
  const api = useApi()
  const loadTree = useWorkbench((state) => state.loadTree)
  const treeId = useWorkbench((state) => state.treeId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [trees, setTrees] = useState<TreeRow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    let active = true
    const listTrees = (api as Partial<Api>).listTrees
    if (!listTrees) return () => { active = false }
    void listTrees()
      .then((result) => { if (active) setTrees(result.trees) })
      .catch(() => { if (active) setError('树列表加载失败，仍可新建。') })
    return () => { active = false }
  }, [api])

  async function create(): Promise<void> {
    const value = title.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.createTree(value)
      loadTree({ nodes: [result.rootNode], rootNodeId: result.rootNode.id, treeId: result.tree.id })
      setTrees((current) => [result.tree, ...current.filter((tree) => tree.id !== result.tree.id)])
      setTitle('')
    } catch {
      setError('新建树失败，请检查本地服务。')
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
      loadTree({ nodes: result.nodes, rootNodeId, treeId: result.tree.id })
    } catch {
      setError('打开树失败。')
    } finally {
      setBusy(false)
    }
  }

  async function remove(tree: TreeRow): Promise<void> {
    if (!window.confirm(`将删除树“${tree.title}”，可在回收站恢复。`)) return
    setError(null)
    setTrees((current) => current.filter((item) => item.id !== tree.id))
    try {
      await api.deleteTree(tree.id)
    } catch {
      setTrees((current) => [tree, ...current])
      setError('删除树失败，请稍后重试。')
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
    } catch {
      setError('重命名失败，请稍后重试。')
    }
  }

  return (
    <section className="tree-launcher" aria-label="树入口">
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
          placeholder="给新树一个标题"
          value={title}
        />
        <button disabled={busy || !title.trim()} onClick={() => { void create() }} title={title.trim() ? undefined : '请先输入标题'} type="button">新建树</button>
      </div>
      {trees.length > 0 && (
        <ul aria-label="已有树">
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
                  <button aria-label={`重命名“${tree.title}”`} className="tree-item-action" onClick={() => beginRename(tree)} type="button">✎</button>
                  <button aria-label={`删除“${tree.title}”`} className="tree-item-action" onClick={() => { void remove(tree) }} type="button">×</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
