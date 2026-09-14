import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useApi } from '../api/context'
import type { Material } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'

const count = (value: number) => value.toLocaleString('en-US')
const messageOf = (cause: unknown) => cause instanceof ApiError && cause.payload && typeof cause.payload === 'object' && 'error' in cause.payload
  ? String(cause.payload.error) : cause instanceof Error ? cause.message : '请求失败，请重试'

export function MaterialsPanel({ treeId }: { treeId: string }) {
  const api = useApi()
  const id = useId()
  const active = useRef(true)
  const busyRef = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ material: Material; trigger: HTMLElement } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const total = materials.reduce((sum, material) => sum + material.content.length, 0)
  const full = materials.length >= 20 || total >= 50_000
  const tooLong = content.length > 10_000
  const disabled = !loaded || busy !== null

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function action(label: string, work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    setError('')
    setNotice('')
    setDeleteError('')
    try { await work() }
    catch (cause) {
      if (active.current) {
        if (label === '删除') setDeleteError(messageOf(cause))
        else setError(messageOf(cause))
      }
    } finally { if (active.current) { busyRef.current = false; setBusy(null) } }
  }
  async function load() {
    await action('加载', async () => {
      const result = await api.listMaterials(treeId)
      if (active.current) { setMaterials(result.materials); setLoaded(true) }
    })
  }
  function accept(material: Material) {
    setMaterials((items) => items.some((item) => item.id === material.id)
      ? items.map((item) => item.id === material.id ? material : item) : [...items, material])
  }
  function clearEditor() { setEditingId(null); setTitle(''); setContent('') }
  async function save() {
    if (disabled || tooLong || !content.trim()) return
    await action('保存', async () => {
      const result = editingId
        ? await api.updateMaterial(editingId, { title, content })
        : await api.createMaterial(treeId, { content, ...(title.trim() ? { title } : {}) })
      if (!active.current) return
      const duplicate = !editingId && materials.some((item) => item.id === result.material.id)
      accept(result.material)
      clearEditor()
      setNotice(duplicate ? '相同内容已在列表中，保留原有状态' : editingId ? '素材已更新' : '素材已保存')
    })
  }
  async function remove() {
    if (!pendingDelete) return
    const target = pendingDelete.material
    await action('删除', async () => {
      await api.deleteMaterial(target.id)
      if (!active.current) return
      setMaterials((items) => items.filter((item) => item.id !== target.id))
      if (editingId === target.id) clearEditor()
      setPendingDelete(null)
      setNotice('素材已删除')
      titleRef.current?.focus()
    })
  }

  return <section className="material-panel" aria-label="参考素材">
    <button type="button" className="material-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => {
      setOpen(!open)
      if (!open && !loaded) void load()
    }}><Icon name={open ? 'chevron-down' : 'chevron-right'} /><span>参考素材</span>{loaded && <span className="material-muted">{materials.filter((item) => item.enabled === 1).length} 条已启用</span>}</button>
    {open && <div id={`${id}-panel`} className="material-content">
      <p className="material-muted">粘贴本树的背景资料，供文档讨论、开放问题和回顾参考。</p>
      {busy && <p role="status" className="material-muted">{busy}中…</p>}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {notice && <p role="status" className="material-muted">{notice}</p>}
      {!loaded && !busy && <button type="button" className="material-button" onClick={() => { void load() }}>重试加载</button>}
      {loaded && <>
        <p className="material-capacity">已用 {materials.length}/20 条 · {count(total)}/50,000 字<span className="material-muted">（停用素材也占容量）</span></p>
        {!materials.length && <p className="material-muted">还没有参考素材。</p>}
        <ul className="material-list">{materials.map((material) => <li key={material.id} aria-label={material.title}>
          <div className="material-summary"><strong>{material.title}</strong><span className="material-muted">{count(material.content.length)} 字 · {material.enabled === 1 ? '已启用·作为讨论参考' : '已停用·不进 AI 上下文'}</span></div>
          <div className="material-actions">
            <label className="material-enable"><input type="checkbox" role="switch" aria-label={`启用素材：${material.title}`} checked={material.enabled === 1} disabled={disabled} onChange={(event) => {
              const enabled = event.target.checked
              void action('更新', async () => { const result = await api.updateMaterial(material.id, { enabled }); if (active.current) accept(result.material) })
            }} />启用</label>
            <button type="button" className="material-button" disabled={disabled} onClick={() => { setEditingId(material.id); setTitle(material.title); setContent(material.content); setError(''); setNotice(''); titleRef.current?.focus() }}>编辑</button>
            <button type="button" className="material-button" disabled={disabled} onClick={(event) => { setDeleteError(''); setPendingDelete({ material, trigger: event.currentTarget }) }}>删除</button>
          </div>
        </li>)}</ul>
      </>}
      <form className="material-form" aria-label={editingId ? '编辑素材' : '添加素材'} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <h3>{editingId ? '编辑素材' : '添加素材'}</h3>
        {loaded && full && <p className="material-muted">当前容量已满，可编辑或删除已有素材；停用仍占容量。</p>}
        <label htmlFor={`${id}-title`}>标题（可选）</label>
        <input id={`${id}-title`} ref={titleRef} type="text" disabled={disabled} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空时取素材首行" />
        <label htmlFor={`${id}-content`}>素材内容</label>
        <textarea id={`${id}-content`} rows={5} disabled={disabled} value={content} onChange={(event) => setContent(event.target.value)} aria-describedby={`${id}-count`} aria-invalid={tooLong} placeholder="在这里粘贴纯文本素材" />
        <p id={`${id}-count`} className={tooLong ? 'material-limit-error' : 'material-muted'}>{count(content.length)}/10,000 字{tooLong ? ' · 超过单条上限，请精简后保存' : ''}</p>
        <div className="material-actions"><button type="submit" className="material-button" disabled={disabled || tooLong || !content.trim()}>{busy === '保存' ? '保存中…' : editingId ? '保存修改' : '保存素材'}</button>
          {editingId && <button type="button" className="material-button" disabled={disabled} onClick={clearEditor}>取消编辑</button>}</div>
      </form>
    </div>}
    {pendingDelete && <ConfirmDialog title="删除素材" message={`将永久删除素材“${pendingDelete.material.title}”。`} busy={busy === '删除'} error={deleteError}
      returnFocusTo={pendingDelete.trigger} onCancel={() => { setPendingDelete(null); setDeleteError('') }} onConfirm={remove} />}
  </section>
}
