import type { TreeRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import { useWorkbench } from '../state/workbench-store'

export function TreeLauncher() {
  const api = useApi()
  const loadTree = useWorkbench((state) => state.loadTree)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [trees, setTrees] = useState<TreeRow[]>([])

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

  return (
    <section className="tree-launcher" aria-label="树入口">
      <div className="new-tree-row">
        <input
          aria-label="new-tree-title"
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void create() }
          }}
          placeholder="给新树一个标题"
          value={title}
        />
        <button disabled={busy || !title.trim()} onClick={() => { void create() }} title={title.trim() ? undefined : '请先输入标题'} type="button">新建树</button>
      </div>
      {trees.length > 0 && (
        <ul aria-label="已有树">
          {trees.map((tree) => (
            <li key={tree.id}><button disabled={busy} onClick={() => { void open(tree) }} type="button">{tree.title}</button></li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
