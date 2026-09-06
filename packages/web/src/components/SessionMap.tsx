import type { AnnotationRow, MergeRow, NodeRow } from '@vibe/shared'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { generationBadgeState } from './SubdocTabs'
import { Icon } from './Icon'
import { formatRelativeTime } from './format-time'
import { nodeTitle } from './TreePanel'
import './SessionMap.css'

const CARD_W = 224
const CARD_H = 88
const PAD = 56
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const FALLBACK_VIEWPORT = { width: 960, height: 640 }
const PREVIEW_W = 300
const PREVIEW_EST_H = 180
const HOVER_MS = 300
const DRAG_THRESHOLD_PX = 4

type Density = 'compact' | 'standard' | 'relaxed'
const DENSITIES: Record<Density, { col: number; row: number; label: string }> = {
  compact: { col: 64, row: 16, label: '紧凑' },
  standard: { col: 96, row: 28, label: '标准' },
  relaxed: { col: 144, row: 44, label: '宽松' },
}
const DENSITY_ORDER: Density[] = ['compact', 'standard', 'relaxed']

const posStorageKey = (treeId: string) => `vibe-docing:session-map-pos:${treeId}`
const densityStorageKey = (treeId: string) => `vibe-docing:session-map-density:${treeId}`

/** 持久化格式 v1：记录保存时的节点集；节点集变化（增/删）即整批失效。 */
interface ManualPosPayload {
  v: 1
  nodeIds: string[]
  pos: Record<string, { x: number; y: number }>
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((id) => set.has(id))
}

function loadManualPositions(treeId: string | null, layout: Record<string, unknown>): Record<string, { x: number; y: number }> {
  if (!treeId) return {}
  try {
    const raw = JSON.parse(localStorage.getItem(posStorageKey(treeId)) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object') return {}
    // 兼容旧格式（裸 {nodeId:{x,y}} map）：等效 nodeIds = Object.keys。
    const record = raw as Record<string, unknown>
    const isV1 = record.v === 1 && Array.isArray(record.nodeIds) && record.pos && typeof record.pos === 'object'
    const pos = (isV1 ? record.pos : record) as Record<string, unknown>
    const savedIds = isV1 ? (record.nodeIds as string[]) : Object.keys(pos)
    // 节点集与保存时不一致 → 手动位置不再可信，整批丢弃并清理存储。
    if (!sameIdSet(savedIds, Object.keys(layout))) {
      try { localStorage.removeItem(posStorageKey(treeId)) } catch {}
      return {}
    }
    const result: Record<string, { x: number; y: number }> = {}
    for (const [id, value] of Object.entries(pos)) {
      const point = value as { x?: unknown; y?: unknown }
      if (layout[id] && typeof point?.x === 'number' && typeof point?.y === 'number') {
        result[id] = { x: point.x, y: point.y }
      }
    }
    return result
  } catch {
    return {}
  }
}

function loadDensity(treeId: string | null): Density {
  if (!treeId) return 'standard'
  try {
    const value = localStorage.getItem(densityStorageKey(treeId))
    return value === 'compact' || value === 'relaxed' ? value : 'standard'
  } catch {
    return 'standard'
  }
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function sortedChildren(nodesById: Record<string, NodeRow>, parentId: string): NodeRow[] {
  return Object.values(nodesById)
    .filter((node) => node.parent_id === parentId && node.is_deleted === 0)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )
}

interface MapLayoutNode {
  id: string
  x: number
  y: number
}

interface MapLayout {
  byId: Record<string, MapLayoutNode>
  edges: Array<{ from: string; to: string }>
  height: number
  width: number
}

/** Horizontal left→right tree layout: depth = column, in-order leaf rows. */
function buildLayout(nodesById: Record<string, NodeRow>, rootNodeId: string | null, density: Density): MapLayout {
  const { col: colGap, row: rowGap } = DENSITIES[density]
  const byId: Record<string, MapLayoutNode> = {}
  const edges: Array<{ from: string; to: string }> = []
  const visited = new Set<string>()
  const alive = Object.values(nodesById).filter((node) => node.is_deleted === 0)
  const roots = alive.filter((node) => !node.parent_id || !nodesById[node.parent_id] || nodesById[node.parent_id]?.is_deleted === 1)
  roots.sort((left, right) =>
    (left.id === rootNodeId ? -1 : 0) - (right.id === rootNodeId ? -1 : 0) ||
    left.sort_order - right.sort_order || left.id.localeCompare(right.id),
  )

  let nextSlot = 0
  let maxDepth = 0
  const place = (node: NodeRow, depth: number): number => {
    if (visited.has(node.id)) return nextSlot
    visited.add(node.id)
    maxDepth = Math.max(maxDepth, depth)
    const children = sortedChildren(nodesById, node.id).filter((child) => !visited.has(child.id))
    let row: number
    if (children.length === 0) {
      row = nextSlot
      nextSlot += 1
    } else {
      const rows = children.map((child) => place(child, depth + 1))
      row = (rows[0] + rows[rows.length - 1]) / 2
    }
    byId[node.id] = {
      id: node.id,
      x: PAD + depth * (CARD_W + colGap),
      y: PAD + row * (CARD_H + rowGap),
    }
    for (const child of children) edges.push({ from: node.id, to: child.id })
    return row
  }
  for (const root of roots) place(root, 0)

  return {
    byId,
    edges,
    height: PAD * 2 + nextSlot * (CARD_H + rowGap) - rowGap,
    width: PAD * 2 + (maxDepth + 1) * (CARD_W + colGap) - colGap,
  }
}

function edgePath(from: MapLayoutNode, to: MapLayoutNode): string {
  const x1 = from.x + CARD_W
  const y1 = from.y + CARD_H / 2
  const x2 = to.x
  const y2 = to.y + CARD_H / 2
  const dx = Math.max(48, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function mergeEdgePath(from: MapLayoutNode, to: MapLayoutNode): string {
  const x1 = from.x + CARD_W / 2
  const y1 = from.y + CARD_H / 2
  const x2 = to.x + CARD_W / 2
  const y2 = to.y + CARD_H / 2
  const cx = (x1 + x2) / 2 - (y2 - y1) * 0.25
  const cy = (y1 + y2) / 2 + (x2 - x1) * 0.25
  return `M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`
}

/** Best-effort plain text from document_content / ai_response (markdown or ProseMirror JSON). */
function plainTextSummary(content: string | null | undefined): string {
  if (!content) return ''
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    try {
      const texts: string[] = []
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(walk); return }
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>
          if (typeof record.text === 'string') texts.push(record.text)
          else Object.values(record).forEach(walk)
        }
      }
      walk(JSON.parse(trimmed))
      return texts.join(' ').replace(/\s+/g, ' ').trim()
    } catch {
      return ''
    }
  }
  return trimmed.replace(/[#>*`_|-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function SessionMap({ onClose }: { onClose(): void }) {  const api = useApi()
  const nodesById = useWorkbench((state) => state.nodesById)
  const rootNodeId = useWorkbench((state) => state.rootNodeId)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const mainPath = useWorkbench((state) => state.mainPath)
  const unreadNodeIds = useWorkbench((state) => state.unreadNodeIds)
  const treeId = useWorkbench((state) => state.treeId)
  const treeTitle = useWorkbench((state) => state.treeTitle)
  const treeAnnotations = useWorkbench((state) => state.treeAnnotations)
  const treeMerges = useWorkbench((state) => state.treeMerges)
  const mergeRefreshTick = useWorkbench((state) => state.mergeRefreshTick)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)

  const [density, setDensity] = useState<Density>(() => loadDensity(treeId))
  const layout = useMemo(() => buildLayout(nodesById, rootNodeId, density), [nodesById, rootNodeId, density])
  const [manualPos, setManualPos] = useState<Record<string, { x: number; y: number }>>(() => loadManualPositions(treeId, layout.byId))
  const nodeCount = Object.keys(layout.byId).length
  const mainPathSet = useMemo(() => new Set(mainPath), [mainPath])

  // 失效卫生：会话进行中节点集变化（新增/删除）→ 手动位置整批失效回正。
  const nodeIdsKey = Object.keys(layout.byId).sort().join(' ')
  const lastNodeIdsKeyRef = useRef(nodeIdsKey)
  useEffect(() => {
    if (lastNodeIdsKeyRef.current === nodeIdsKey) return
    lastNodeIdsKeyRef.current = nodeIdsKey
    setManualPos((current) => {
      if (Object.keys(current).length === 0) return current
      if (treeId) {
        try { localStorage.removeItem(posStorageKey(treeId)) } catch {}
      }
      return {}
    })
  }, [nodeIdsKey, treeId])

  // Effective positions = computed layout overlaid with manual placements.
  const effectiveById = useMemo(() => {
    const merged: Record<string, MapLayoutNode> = {}
    for (const [id, pos] of Object.entries(layout.byId)) {
      merged[id] = manualPos[id] ? { id, x: manualPos[id].x, y: manualPos[id].y } : pos
    }
    return merged
  }, [layout, manualPos])

  // 手动布局指示：生效的手动位置数 > 0 时，「自动整理」转强调态。
  const hasManualLayout = Object.keys(manualPos).length > 0

  // 选区派生边：`${parent}->{child}` → quoted_text。
  const edgeQuotes = useMemo(() => {
    const map = new Map<string, string>()
    for (const annotation of treeAnnotations as AnnotationRow[]) {
      if (annotation.child_node_id && annotation.quoted_text) {
        map.set(`${annotation.node_id}->${annotation.child_node_id}`, annotation.quoted_text)
      }
    }
    return map
  }, [treeAnnotations])

  const visibleMerges = useMemo(
    () => (treeMerges as MergeRow[]).filter((merge) => layout.byId[merge.source_node_id] && layout.byId[merge.target_node_id]),
    [treeMerges, layout],
  )

  const canvasRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const bgDragRef = useRef<{ baseX: number; baseY: number; startX: number; startY: number } | null>(null)
  const cardDragRef = useRef<{ id: string; originX: number; originY: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMergeTickRef = useRef(mergeRefreshTick)
  const [view, setView] = useState({ x: PAD, y: PAD, zoom: 1 })
  const [smooth, setSmooth] = useState(false)
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [edgeTip, setEdgeTip] = useState<{ text: string; x: number; y: number } | null>(null)
  // 图例：桌面默认展开、窄屏默认折叠；不持久化（每次打开地图重置）。
  // 断点单一来源：全局 1023/767（与 Workbench.css 壳层一致）。
  const [legendOpen, setLegendOpen] = useState(
    () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1024px)').matches,
  )

  const searchActive = query.trim().length >= 2
  const matchSet = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = new Set<string>()
    for (const id of Object.keys(layout.byId)) {
      const node = nodesById[id]
      if (!node) continue
      if (searchActive) {
        const haystack = `${node.user_input ?? ''}\n${node.ai_response ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) continue
      }
      if (unreadOnly && !unreadNodeIds.includes(id)) continue
      matched.add(id)
    }
    return matched
  }, [layout, nodesById, query, searchActive, unreadOnly, unreadNodeIds])
  const filtering = searchActive || unreadOnly
  const isDimmed = (id: string) => filtering && !matchSet.has(id)

  function viewportSize(): { width: number; height: number } {
    const canvas = canvasRef.current
    if (!canvas) return FALLBACK_VIEWPORT
    return {
      width: canvas.clientWidth || FALLBACK_VIEWPORT.width,
      height: canvas.clientHeight || FALLBACK_VIEWPORT.height,
    }
  }

  function centerOn(layoutNode: MapLayoutNode, zoom: number): { x: number; y: number; zoom: number } {
    const viewport = viewportSize()
    return {
      x: viewport.width / 2 - (layoutNode.x + CARD_W / 2) * zoom,
      y: viewport.height / 2 - (layoutNode.y + CARD_H / 2) * zoom,
      zoom,
    }
  }

  function locateCurrent(): void {
    const target = (mainNodeId && effectiveById[mainNodeId]) || (rootNodeId && effectiveById[rootNodeId])
    if (!target) return
    setSmooth(true)
    setView((current) => centerOn(target, current.zoom))
  }

  function fitCanvas(): void {
    const viewport = viewportSize()
    const zoom = clampZoom(Math.min(viewport.width / layout.width, viewport.height / layout.height) * 0.92)
    setSmooth(true)
    setView({
      x: (viewport.width - layout.width * zoom) / 2,
      y: (viewport.height - layout.height * zoom) / 2,
      zoom,
    })
  }

  function stepZoom(direction: 1 | -1): void {
    setSmooth(true)
    setView((current) => {
      const zoom = clampZoom(Math.round(current.zoom * 10 + direction) / 10)
      const viewport = viewportSize()
      const cx = viewport.width / 2
      const cy = viewport.height / 2
      const scale = zoom / current.zoom
      return { x: cx - (cx - current.x) * scale, y: cy - (cy - current.y) * scale, zoom }
    })
  }

  function changeDensity(next: Density): void {
    setDensity(next)
    if (treeId) {
      try { localStorage.setItem(densityStorageKey(treeId), next) } catch {}
    }
  }

  function autoArrange(): void {
    setManualPos({})
    if (treeId) {
      try { localStorage.removeItem(posStorageKey(treeId)) } catch {}
    }
    // layout 回到计算值后适应画布（fitCanvas 读的是旧 layout 尺寸也安全：内容只小不大）。
    const viewport = viewportSize()
    const zoom = clampZoom(Math.min(viewport.width / layout.width, viewport.height / layout.height) * 0.92)
    setSmooth(true)
    setView({
      x: (viewport.width - layout.width * zoom) / 2,
      y: (viewport.height - layout.height * zoom) / 2,
      zoom,
    })
  }

  function selectNode(id: string): void {
    useWorkbench.getState().setMain(id)
    onClose()
  }

  function quickBranch(id: string): void {
    useWorkbench.getState().setMain(id)
    onClose()
    window.dispatchEvent(new CustomEvent('vibe:focus-ask'))
  }

  // ---- 悬停 / 聚焦预览卡 ----
  function schedulePreview(id: string): void {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setPreviewId(id), HOVER_MS)
  }
  function hidePreview(): void {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    setPreviewId(null)
  }

  // ---- 键盘树导航 ----
  function focusCard(id: string): void {
    const card = canvasRef.current?.querySelector<HTMLElement>(`.session-map-card[data-node-id="${id}"]`)
    if (!card) return
    card.focus()
    // 焦点卡滚动到可见：按需最小平移
    const pos = effectiveById[id]
    if (!pos) return
    const viewport = viewportSize()
    setSmooth(true)
    setView((current) => {
      const left = current.x + pos.x * current.zoom
      const top = current.y + pos.y * current.zoom
      const right = left + CARD_W * current.zoom
      const bottom = top + CARD_H * current.zoom
      let { x, y } = current
      if (left < 0) x -= left - 16
      else if (right > viewport.width) x -= right - viewport.width + 16
      if (top < 0) y -= top - 16
      else if (bottom > viewport.height) y -= bottom - viewport.height + 16
      return x === current.x && y === current.y ? current : { ...current, x, y }
    })
  }

  function handleCardKeyDown(event: React.KeyboardEvent, id: string): void {
    const node = nodesById[id]
    if (!node) return
    let target: string | null = null
    if (event.key === 'ArrowRight') {
      target = sortedChildren(nodesById, id)[0]?.id ?? null
    } else if (event.key === 'ArrowLeft') {
      target = node.parent_id && effectiveById[node.parent_id] ? node.parent_id : null
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const parentId = node.parent_id
      const siblings = parentId ? sortedChildren(nodesById, parentId) : []
      const index = siblings.findIndex((sibling) => sibling.id === id)
      if (index >= 0) {
        const next = event.key === 'ArrowDown' ? siblings[index + 1] : siblings[index - 1]
        target = next?.id ?? null
      }
    } else if (event.key === 'Home') {
      target = rootNodeId
    } else {
      return
    }
    event.preventDefault()
    if (target) focusCard(target)
  }

  // Focus the close button on open; restore the recorded trigger on close.
  useLayoutEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const restore = restoreFocusRef.current
    return () => restore?.focus()
  }, [])

  // Center on the current node when the map first opens.
  useLayoutEffect(() => {
    const target = (mainNodeId && effectiveById[mainNodeId]) || (rootNodeId && effectiveById[rootNodeId])
    if (target) setView(centerOn(target, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 合并完成后经 getTree 刷新 annotations/merges（合同允许的唯一请求；跳过首次挂载）。
  useEffect(() => {
    if (mergeRefreshTick === lastMergeTickRef.current) return
    lastMergeTickRef.current = mergeRefreshTick
    const getTree = (api as Partial<Api>).getTree
    const currentTreeId = treeId
    if (!getTree || !currentTreeId) return
    getTree(currentTreeId)
      .then((result) => {
        if (useWorkbench.getState().treeId !== currentTreeId) return
        useWorkbench.getState().setTreeGraph({ annotations: result.annotations, merges: result.merges })
      })
      .catch(() => {})
  }, [api, mergeRefreshTick, treeId])

  // Native wheel listener so the page behind the overlay never scrolls/zooms.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      setSmooth(false)
      setView((current) => {
        const zoom = clampZoom(current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
        const scale = zoom / current.zoom
        return { x: cx - (cx - current.x) * scale, y: cy - (cy - current.y) * scale, zoom }
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button > 0) return
    const cardEl = (event.target as HTMLElement).closest<HTMLElement>('.session-map-card')
    if (cardEl?.dataset.nodeId) {
      // 卡片按下：进入待定拖拽（>4px 才生效，否则算作点击）
      const id = cardEl.dataset.nodeId
      const pos = effectiveById[id]
      if (!pos) return
      cardDragRef.current = {
        id,
        originX: pos.x,
        originY: pos.y,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      }
    } else {
      bgDragRef.current = {
        baseX: view.x,
        baseY: view.y,
        startX: event.clientX,
        startY: event.clientY,
      }
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {}
    setSmooth(false)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const cardDrag = cardDragRef.current
    if (cardDrag) {
      const dx = event.clientX - cardDrag.startX
      const dy = event.clientY - cardDrag.startY
      if (!cardDrag.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return
      cardDrag.moved = true
      suppressClickRef.current = true
      hidePreview()
      setManualPos((current) => ({
        ...current,
        [cardDrag.id]: {
          x: cardDrag.originX + dx / view.zoom,
          y: cardDrag.originY + dy / view.zoom,
        },
      }))
      return
    }
    const bgDrag = bgDragRef.current
    if (!bgDrag) return
    setSmooth(false)
    setView((current) => ({
      ...current,
      x: bgDrag.baseX + event.clientX - bgDrag.startX,
      y: bgDrag.baseY + event.clientY - bgDrag.startY,
    }))
  }

  function handlePointerUp(): void {
    const cardDrag = cardDragRef.current
    if (cardDrag?.moved) {
      // 拖拽结束才持久化，按树存储（v1：连同当前节点集，供失效校验）
      setManualPos((current) => {
        if (treeId) {
          const payload: ManualPosPayload = { v: 1, nodeIds: Object.keys(layout.byId), pos: current }
          try { localStorage.setItem(posStorageKey(treeId), JSON.stringify(payload)) } catch {}
        }
        return current
      })
    }
    cardDragRef.current = null
    bgDragRef.current = null
  }

  function edgeTooltip(event: React.MouseEvent, text: string): void {
    const rect = canvasRef.current?.getBoundingClientRect()
    setEdgeTip({
      text,
      x: event.clientX - (rect?.left ?? 0) + 12,
      y: event.clientY - (rect?.top ?? 0) + 12,
    })
  }

  const previewNode = previewId ? nodesById[previewId] : undefined
  const previewPos = previewId ? effectiveById[previewId] : undefined
  let previewStyle: React.CSSProperties | undefined
  if (previewPos) {
    const viewport = viewportSize()
    let left = view.x + (previewPos.x + CARD_W) * view.zoom + 8
    let top = view.y + previewPos.y * view.zoom
    if (left + PREVIEW_W > viewport.width - 8) left = view.x + previewPos.x * view.zoom - PREVIEW_W - 8
    if (top + PREVIEW_EST_H > viewport.height - 8) top = Math.max(8, viewport.height - PREVIEW_EST_H - 8)
    previewStyle = { left: Math.max(8, left), top: Math.max(8, top) }
  }

  return (
    <div
      aria-label="会话地图"
      aria-modal="true"
      className="session-map-overlay"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        if (query) {
          setQuery('')
          return
        }
        onClose()
      }}
      role="dialog"
    >
      <header className="session-map-toolbar">
        <div className="session-map-heading">
          <span className="eyebrow">会话地图</span>
          {treeTitle && <span className="session-map-tree-title">{treeTitle}</span>}
          <span className="session-map-count">共 {nodeCount} 个节点</span>
        </div>
        <div className="session-map-search">
          <Icon name="search" size={14} />
          <input
            aria-label="搜索节点"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索问题或回答…"
            type="search"
            value={query}
          />
          <button
            aria-label="只看未读"
            aria-pressed={unreadOnly}
            className={`quiet-button session-map-unread-toggle${unreadOnly ? ' is-on' : ''}`}
            onClick={() => setUnreadOnly((value) => !value)}
            type="button"
          >
            <Icon name="eye" size={14} />只看未读
          </button>
        </div>
        <div className="session-map-actions">
          <div aria-label="布局密度" className="session-map-density" role="group">
            <Icon name="density" size={14} />
            {DENSITY_ORDER.map((level) => (
              <button
                aria-pressed={density === level}
                className={`quiet-button${density === level ? ' is-on' : ''}`}
                key={level}
                onClick={() => changeDensity(level)}
                type="button"
              >
                {DENSITIES[level].label}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="session-map-divider" />
          <button
            className={`quiet-button session-map-arrange${hasManualLayout ? ' is-manual' : ''}`}
            onClick={autoArrange}
            title={hasManualLayout ? '检测到手动摆放的卡片，点击恢复规整布局' : undefined}
            type="button"
          >
            <Icon name="arrange" size={14} />自动整理
          </button>
          <div aria-label="缩放" className="session-map-zoom" role="group">
            <button
              aria-label="缩小"
              className="quiet-button"
              disabled={view.zoom <= MIN_ZOOM}
              onClick={() => stepZoom(-1)}
              type="button"
            >
              <Icon name="minus" size={14} />
            </button>
            <output aria-label="当前缩放" className="session-map-zoom-value">{Math.round(view.zoom * 100)}%</output>
            <button
              aria-label="放大"
              className="quiet-button"
              disabled={view.zoom >= MAX_ZOOM}
              onClick={() => stepZoom(1)}
              type="button"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          <button className="quiet-button" onClick={fitCanvas} type="button">适应画布</button>
          <button className="quiet-button" onClick={locateCurrent} type="button">定位当前</button>
          <button aria-label="关闭会话地图" className="quiet-button session-map-close" onClick={onClose} ref={closeRef} type="button">
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div
        className="session-map-canvas"
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
      >
        <div
          className={`session-map-viewport${smooth ? ' is-smooth' : ''}`}
          style={{
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            width: layout.width,
          }}
        >
          <svg
            aria-hidden="true"
            className="session-map-edges"
            height={layout.height}
            width={layout.width}
          >
            {layout.edges.map(({ from, to }) => {
              const fromNode = effectiveById[from]
              const toNode = effectiveById[to]
              if (!fromNode || !toNode) return null
              const active = mainPathSet.has(from) && mainPathSet.has(to)
              const quote = edgeQuotes.get(`${from}->${to}`)
              const dimmed = filtering && (isDimmed(from) || isDimmed(to))
              const d = edgePath(fromNode, toNode)
              const tip = quote
                ? `派生自选区：「${quote.slice(0, 40)}${quote.length > 40 ? '…' : ''}」`
                : '由提问派生'
              return (
                <g key={`${from}->${to}`}>
                  <path
                    className="session-map-edge-hit"
                    d={d}
                    onMouseEnter={(event) => edgeTooltip(event, tip)}
                    onMouseLeave={() => setEdgeTip(null)}
                    onMouseMove={(event) => edgeTooltip(event, tip)}
                  />
                  <path
                    className={`session-map-edge${active ? ' is-active' : ''}${quote ? ' is-annotated' : ''}${dimmed ? ' is-dimmed' : ''}`}
                    d={d}
                    data-edge-from={from}
                    data-edge-to={to}
                  />
                  {quote && (
                    <circle
                      className={`session-map-edge-dot${dimmed ? ' is-dimmed' : ''}`}
                      cx={fromNode.x + CARD_W + 5}
                      cy={fromNode.y + CARD_H / 2}
                      r={3}
                    />
                  )}
                </g>
              )
            })}
            {visibleMerges.map((merge) => {
              const fromNode = effectiveById[merge.source_node_id]
              const toNode = effectiveById[merge.target_node_id]
              if (!fromNode || !toNode) return null
              const d = mergeEdgePath(fromNode, toNode)
              const correction = merge.kind === 'correction'
              const detail = correction ? (merge.direction ?? '') : merge.conclusion
              const tip = `${correction ? '合并说明' : '合并结论'}：${detail.slice(0, 60)}${detail.length > 60 ? '…' : ''}`
              return (
                <g key={merge.id}>
                  <path
                    className="session-map-edge-hit"
                    d={d}
                    onMouseEnter={(event) => edgeTooltip(event, tip)}
                    onMouseLeave={() => setEdgeTip(null)}
                    onMouseMove={(event) => edgeTooltip(event, tip)}
                  />
                  <path
                    className={`session-map-merge-edge${correction ? ' is-correction' : ''}`}
                    d={d}
                    data-merge-id={merge.id}
                    data-merge-kind={merge.kind ?? 'summary'}
                  />
                </g>
              )
            })}
          </svg>
          {Object.values(effectiveById).map((layoutNode) => {
            const node = nodesById[layoutNode.id]
            if (!node) return null
            const taskKey = taskKeyByTarget[node.id]
            const task = taskKey ? tasksByKey[taskKey] : undefined
            const badge = generationBadgeState(node, task)
            const isCurrent = node.id === mainNodeId
            const unread = unreadNodeIds.includes(node.id)
            const title = nodeTitle(node, treeTitle)
            const statusLabel = badge?.label ?? (node.status === 'draft' ? '草稿' : '完成')
            const accessibleLabel = `${title}，${statusLabel}${isCurrent ? '，当前' : ''}${unread ? '，未读' : ''}`
            return (
              <div
                className={`session-map-card-wrap${isDimmed(node.id) ? ' is-dimmed' : ''}`}
                key={node.id}
                style={{ left: layoutNode.x, top: layoutNode.y }}
              >
                <button
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={accessibleLabel}
                  className={`session-map-card${isCurrent ? ' is-current' : ''}${badge ? ` is-${badge.status}` : ''}`}
                  data-node-id={node.id}
                  data-x={layoutNode.x}
                  data-y={layoutNode.y}
                  onBlur={hidePreview}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    selectNode(node.id)
                  }}
                  onFocus={() => schedulePreview(node.id)}
                  onKeyDown={(event) => handleCardKeyDown(event, node.id)}
                  onMouseEnter={() => schedulePreview(node.id)}
                  onMouseLeave={hidePreview}
                  title={title}
                  type="button"
                >
                  <span className="session-map-card-title">{title}</span>
                  <span className="session-map-card-meta">
                    <span className={`session-map-card-status${badge?.status === 'streaming' ? ' is-animated' : ''}`} data-status={badge?.status ?? node.status}>
                      {statusLabel}
                    </span>
                    {isCurrent && <span className="session-map-card-current">当前</span>}
                    {unread && <span aria-hidden="true" className="session-map-card-unread" />}
                  </span>
                </button>
                <button
                  aria-label="新建分支"
                  title={`在“${title}”下新建分支`}
                  className="session-map-branch"
                  onClick={(event) => {
                    event.stopPropagation()
                    quickBranch(node.id)
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>
            )
          })}
        </div>
        {previewNode && previewStyle && (
          <div className="session-map-preview" data-node-id={previewNode.id} role="tooltip" style={previewStyle}>
            <p className="session-map-preview-question">{previewNode.user_input?.trim() || '（无提问内容）'}</p>
            {plainTextSummary(previewNode.document_content ?? previewNode.ai_response) && (
              <p className="session-map-preview-answer">
                {(() => {
                  const summary = plainTextSummary(previewNode.document_content ?? previewNode.ai_response)
                  return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary
                })()}
              </p>
            )}
            {formatRelativeTime(previewNode.created_at) && (
              <p className="session-map-preview-time">{formatRelativeTime(previewNode.created_at)}</p>
            )}
          </div>
        )}
        {edgeTip && (
          <div className="session-map-edge-tip" role="tooltip" style={{ left: edgeTip.x, top: edgeTip.y }}>
            {edgeTip.text}
          </div>
        )}
        <aside
          aria-label="连线图例"
          className={`session-map-legend${legendOpen ? '' : ' is-collapsed'}`}
          onPointerDown={(event) => event.stopPropagation()}
          role="note"
        >
          {legendOpen ? (
            <>
              <div className="session-map-legend-head">
                <span>图例</span>
                <button
                  aria-expanded={legendOpen}
                  aria-label="折叠图例"
                  className="quiet-button session-map-legend-toggle"
                  onClick={() => setLegendOpen(false)}
                  type="button"
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              </div>
              <ul className="session-map-legend-list">
                <li>
                  <svg aria-hidden="true" height="12" width="24"><path d="M1 8 C 9 4, 15 10, 23 6" fill="none" stroke="#E0DFDC" strokeWidth="1.5" /></svg>
                  <span>会话上下文（父子）</span>
                </li>
                <li>
                  <svg aria-hidden="true" height="12" width="24"><circle cx="3" cy="6" fill="#B7B5B0" r="2.5" /><path d="M5 6 C 11 6, 17 6, 23 6" fill="none" stroke="#B7B5B0" strokeWidth="1.5" /></svg>
                  <span>由选区文字派生</span>
                </li>
                <li>
                  <svg aria-hidden="true" height="12" width="24"><path d="M1 9 Q 12 1, 23 9" fill="none" stroke="#B7B5B0" strokeDasharray="4 3" strokeWidth="1.5" /></svg>
                  <span>跨分支合并</span>
                </li>
                <li>
                  <svg aria-hidden="true" height="12" width="24"><path d="M1 6 C 9 6, 15 6, 23 6" fill="none" stroke="#2383E2" strokeWidth="2" /></svg>
                  <span>当前阅读路径</span>
                </li>
              </ul>
            </>
          ) : (
            <button
              aria-expanded={legendOpen}
              aria-label="展开图例"
              className="quiet-button session-map-legend-open"
              onClick={() => setLegendOpen(true)}
              type="button"
            >
              图例
            </button>
          )}
        </aside>
        {nodeCount <= 1 && (
          <p className="session-map-empty">
            还没有分支。继续提问或生成关联内容后，这里会呈现完整的会话地图。
          </p>
        )}
        {filtering && matchSet.size === 0 && (
          <p className="session-map-empty" role="status">
            没有匹配的节点。试试更换关键词{unreadOnly ? '，或关闭“只看未读”' : ''}。
          </p>
        )}
      </div>
    </div>
  )
}
