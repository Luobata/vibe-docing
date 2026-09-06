import { parseNodeTags, sanitizeTagList, type NodeRow } from '@vibe/shared'
import { useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Icon } from './Icon'

/**
 * 标签 chips（Round 13 · C）：展示 AI 自动生成的标签，用户可增删。
 * 乐观更新 + 失败回滚 toast；streaming 中编辑入口禁用（避免与流式 upsertNode 竞态）。
 */
export function TagChips({ node }: { node: NodeRow }) {
  const api = useApi()
  const upsertNode = useWorkbench((state) => state.upsertNode)
  // 订阅 store 中的最新节点：乐观更新/流式 upsert 后 chips 即时刷新。
  const liveNode = useWorkbench((state) => state.nodesById[node.id]) ?? node
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const tags = parseNodeTags(liveNode.tags_json)
  const streaming = liveNode.status === 'streaming'

  async function commit(next: string[]): Promise<void> {
    const sanitized = sanitizeTagList(next)
    // 从 store 取最新 node，避免乐观更新基于过期 props。
    const current = useWorkbench.getState().nodesById[node.id] ?? node
    const previousTagsJson = current.tags_json ?? null
    upsertNode({ ...current, tags_json: JSON.stringify(sanitized) })
    setBusy(true)
    try {
      const result = await api.updateNodeTags(node.id, sanitized)
      upsertNode(result.node)
    } catch {
      upsertNode({ ...current, tags_json: previousTagsJson })
      useWorkbench.getState().setToast('标签保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  function submitDraft(): void {
    const value = draft.trim()
    if (!value) return
    setAdding(false)
    setDraft('')
    void commit([...tags, value])
  }

  return (
    <span className="tag-chips" data-testid="tag-chips">
      {tags.map((tag) => (
        <span className="tag-chip" key={tag}>
          <span>{tag}</span>
          {!streaming && (
            <button
              aria-label={`删除标签“${tag}”`}
              className="tag-chip-remove"
              disabled={busy}
              onClick={() => { void commit(tags.filter((item) => item !== tag)) }}
              type="button"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      {streaming && tags.length === 0 && (
        <span className="tag-chips-pending" role="status">标签生成中…</span>
      )}
      {!streaming && !adding && (
        <button
          aria-label="添加标签"
          className="tag-chip-add"
          disabled={busy}
          onClick={() => setAdding(true)}
          title="添加标签"
          type="button"
        >
          <Icon name="plus" size={12} />{tags.length === 0 ? '添加标签' : null}
        </button>
      )}
      {!streaming && adding && (
        <input
          aria-label="新标签名"
          autoFocus
          className="tag-chip-input"
          disabled={busy}
          onBlur={() => { setAdding(false); setDraft('') }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); submitDraft() }
            if (event.key === 'Escape') { event.preventDefault(); setAdding(false); setDraft('') }
          }}
          placeholder="标签名"
          type="text"
          value={draft}
        />
      )}
    </span>
  )
}
