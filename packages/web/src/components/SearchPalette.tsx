import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Icon } from './Icon'
import './SearchPalette.css'

interface SearchHit {
  nodeId: string
  snippet: string
  title: string
  treeId: string
  treeTitle: string
}

/**
 * Cmd/Ctrl+K 全局搜索面板：跨笔记库快速跳转。
 * 对话框语义：role=dialog + aria-modal；输入框以 aria-activedescendant 指向结果项。
 */
export function SearchPalette({ onClose }: { onClose(): void }) {
  const api = useApi()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // 挂载时记录触发元素并聚焦输入框；卸载时还原焦点。
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => { restoreFocusRef.current?.focus() }
  }, [])

  // 250ms debounce；<2 字符不请求（服务端也返回空）。
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      setLoading(false)
      setActiveIndex(0)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      api.search(q, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          setHits(result.hits)
          setActiveIndex(0)
          setLoading(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setHits([])
          setLoading(false)
        })
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [api, query])

  async function openHit(hit: SearchHit): Promise<void> {
    try {
      const state = useWorkbench.getState()
      if (hit.treeId !== state.treeId) {
        const data = await api.getTree(hit.treeId)
        const rootId = data.tree.root_node_id ?? data.nodes.find((node) => node.parent_id === null)?.id
        if (!rootId) return
        state.loadTree({
          annotations: data.annotations,
          merges: data.merges,
          nodes: data.nodes,
          rootNodeId: rootId,
          treeId: hit.treeId,
          treeTitle: data.tree.title,
        })
      }
      useWorkbench.getState().setMain(hit.nodeId)
      onClose()
    } catch {
      useWorkbench.getState().setToast('打开笔记失败，请重试。')
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (hits.length === 0) return
    let next = activeIndex
    if (event.key === 'ArrowDown') next = (activeIndex + 1) % hits.length
    else if (event.key === 'ArrowUp') next = (activeIndex - 1 + hits.length) % hits.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = hits.length - 1
    else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[activeIndex]
      if (hit) void openHit(hit)
      return
    } else return
    event.preventDefault()
    setActiveIndex(next)
  }

  const trimmed = query.trim()
  return (
    <div className="search-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        aria-label="搜索笔记"
        aria-modal="true"
        className="search-palette"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="search-palette-input-row">
          <Icon name="search" size={16} />
          <input
            aria-activedescendant={hits.length > 0 ? `search-hit-${activeIndex}` : undefined}
            aria-controls="search-palette-results"
            aria-label="搜索全部笔记库"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索全部笔记库…"
            ref={inputRef}
            type="text"
            value={query}
          />
          <kbd>esc</kbd>
        </div>
        <div className="search-palette-body">
          {trimmed.length === 0 && <p className="search-palette-hint">输入关键词，在所有笔记库中查找</p>}
          {trimmed.length === 1 && <p className="search-palette-hint">至少输入 2 个字符</p>}
          {loading && trimmed.length >= 2 && <p className="search-palette-hint" role="status">搜索中…</p>}
          {!loading && trimmed.length >= 2 && hits.length === 0 && (
            <p className="search-palette-hint">没有匹配「{trimmed}」的笔记</p>
          )}
          {hits.length > 0 && (
            <ul aria-label="搜索结果" id="search-palette-results" role="listbox">
              {hits.map((hit, index) => (
                <li
                  aria-selected={index === activeIndex}
                  className="search-palette-hit"
                  id={`search-hit-${index}`}
                  key={`${hit.treeId}:${hit.nodeId}`}
                  onClick={() => { void openHit(hit) }}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                >
                  <span className="search-palette-hit-title">{hit.title || '未命名'}</span>
                  <span className="search-palette-hit-tree">{hit.treeTitle}</span>
                  {hit.snippet && <span className="search-palette-hit-snippet">{hit.snippet}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
