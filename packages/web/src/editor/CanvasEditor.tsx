import { documentContentOf, parseJsonCanvas, type JsonCanvasEdge, type JsonCanvasFile, type JsonCanvasNode, type NodeRow } from '@vibe/shared'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ApiError } from '../api/client'
import { Icon } from '../components/Icon'
import { useApi } from '../api/context'
import { renderMarkdown } from '../doc/markdown'
import { useWorkbench } from '../state/workbench-store'
import type { DocumentEditorHandle, DocumentEditorProps } from './DocumentEditor'

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

const EMPTY_CANVAS = '{\n  "nodes": [],\n  "edges": []\n}\n'
const CANVAS_GRID = { columnGap: 40, columns: 2, maxHeight: 300, maxWidth: 420, startX: 80, startY: 80 }

function sourceFromNode(node: NodeRow): string {
  return documentContentOf(node) || EMPTY_CANVAS
}

function id(prefix: string): string {
  return `${prefix}-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
}

function center(node: JsonCanvasNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

function canvasNodeTypeLabel(type: JsonCanvasNode['type']): string {
  return type === 'text' ? '文本卡片' : type === 'file' ? '文件卡片' : type === 'link' ? '链接卡片' : '分组'
}

function canvasNodeSummary(node: JsonCanvasNode): string {
  if (node.type === 'text') return node.text?.trim().split('\n')[0] || '空文本'
  if (node.type === 'file') return node.file || '未选择文件'
  if (node.type === 'link') return node.url || '未设置链接'
  return node.label || '未命名分组'
}

export function safeCanvasUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = new URL(value.trim())
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function gridPosition(index: number): { x: number; y: number } {
  return {
    x: CANVAS_GRID.startX + (index % CANVAS_GRID.columns) * (CANVAS_GRID.maxWidth + CANVAS_GRID.columnGap),
    y: CANVAS_GRID.startY + Math.floor(index / CANVAS_GRID.columns) * (CANVAS_GRID.maxHeight + CANVAS_GRID.columnGap),
  }
}

function overlapsAt(nodes: JsonCanvasNode[], x: number, y: number, width: number, height: number): boolean {
  const gap = 24
  return nodes.some((node) =>
    x < node.x + node.width + gap &&
    x + width + gap > node.x &&
    y < node.y + node.height + gap &&
    y + height + gap > node.y,
  )
}

function nextOpenPosition(nodes: JsonCanvasNode[], width: number, height: number): { x: number; y: number } {
  for (let index = 0; index < nodes.length + 40; index += 1) {
    const candidate = gridPosition(index)
    if (!overlapsAt(nodes, candidate.x, candidate.y, width, height)) return candidate
  }
  return gridPosition(nodes.length)
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = state === 'saving' ? '保存中…'
    : state === 'dirty' ? '未保存'
      : state === 'error' ? 'JSON 无效'
        : state === 'conflict' ? '文件冲突' : '已保存'
  return <span aria-live="polite" className="document-save-state" data-state={state}>{label}</span>
}

export const CanvasEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function CanvasEditor({
  disabled = false,
  node,
  onSaved,
}, ref) {
  const api = useApi()
  const nodesById = useWorkbench((state) => state.nodesById)
  const initialSource = sourceFromNode(node)
  const [source, setSource] = useState(initialSource)
  const [canvas, setCanvas] = useState<JsonCanvasFile | undefined>(() => parseJsonCanvas(initialSource))
  const [mode, setMode] = useState<'canvas' | 'source'>(() => parseJsonCanvas(initialSource) ? 'canvas' : 'source')
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletedSnapshot, setDeletedSnapshot] = useState<JsonCanvasFile | null>(null)
  const [zoom, setZoom] = useState(1)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef(initialSource)
  const lastSavedRef = useRef(initialSource)
  const revisionRef = useRef(node.content_revision ?? 0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const flushRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {})
  const editSessionId = useMemo(() => id(`canvas-${node.id}`), [node.id])
  const dragRef = useRef<{ id: string; pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const fileOptions = useMemo(() => [...new Set(
    Object.values(nodesById)
      .filter((item) => item.is_deleted === 0 && Boolean(item.file_path))
      .map((item) => item.file_path as string),
  )].sort((left, right) => left.localeCompare(right)), [nodesById])

  const bounds = useMemo(() => {
    if (!canvas?.nodes.length) return { height: 720, minX: 0, minY: 0, width: 1080 }
    const minX = Math.min(0, ...canvas.nodes.map((item) => item.x))
    const minY = Math.min(0, ...canvas.nodes.map((item) => item.y))
    const width = Math.max(1080, ...canvas.nodes.map((item) => item.x + item.width - minX + 160))
    const height = Math.max(720, ...canvas.nodes.map((item) => item.y + item.height - minY + 160))
    return { height, minX, minY, width }
  }, [canvas])

  function scheduleSave(nextSource: string): void {
    latestRef.current = nextSource
    setSource(nextSource)
    setSaveState(nextSource === lastSavedRef.current ? 'clean' : 'dirty')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flushRef.current().catch(() => {}) }, 750)
  }

  function commit(next: JsonCanvasFile, keepDeleteUndo = false): void {
    if (!keepDeleteUndo) setDeletedSnapshot(null)
    setCanvas(next)
    scheduleSave(JSON.stringify(next, null, 2) + '\n')
  }

  async function saveLatest(keepalive = false): Promise<void> {
    if (latestRef.current === lastSavedRef.current) return
    const submitted = latestRef.current
    if (!parseJsonCanvas(submitted)) { setSaveState('error'); throw new Error('invalid JSON Canvas') }
    setSaveState('saving')
    try {
      const payload = {
        anchors: [],
        baseRevision: revisionRef.current,
        editSessionId,
        fileKind: 'canvas' as const,
        schemaVersion: 2 as const,
        source: submitted,
      }
      const result = keepalive
        ? await api.saveDocumentContent(node.id, payload, { keepalive: true })
        : await api.saveDocumentContent(node.id, payload)
      revisionRef.current = result.content.revision
      lastSavedRef.current = submitted
      onSaved(result.node)
      setSaveState(latestRef.current === submitted ? 'saved' : 'dirty')
    } catch (error) {
      setSaveState(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error')
      throw error
    }
  }

  async function flush(keepalive = false): Promise<void> {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (inFlightRef.current) await inFlightRef.current.catch(() => {})
    if (latestRef.current === lastSavedRef.current) return
    const request = saveLatest(keepalive)
    inFlightRef.current = request
    try { await request } finally { if (inFlightRef.current === request) inFlightRef.current = null }
  }
  flushRef.current = flush
  useImperativeHandle(ref, () => ({ flush, focus: () => surfaceRef.current?.focus() }), [node.id])

  useEffect(() => {
    const next = sourceFromNode(node)
    setSource(next)
    latestRef.current = next
    lastSavedRef.current = next
    revisionRef.current = node.content_revision ?? revisionRef.current
    const parsed = parseJsonCanvas(next)
    setCanvas(parsed)
    if (!parsed) setMode('source')
    setSaveState('clean')
  }, [node.ai_response, node.document_content, node.content_revision, node.id])

  useEffect(() => {
    const persist = () => { void flushRef.current(true).catch(() => {}) }
    window.addEventListener('beforeunload', persist)
    return () => { window.removeEventListener('beforeunload', persist); persist() }
  }, [node.id])

  useEffect(() => {
    if (mode !== 'canvas' || !canvas) return
    const frame = requestAnimationFrame(() => fitCanvas())
    window.addEventListener('resize', fitCanvas)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', fitCanvas)
    }
  }, [mode, node.id])

  async function loadDiskVersion(): Promise<void> {
    try {
      const result = await api.getNode(node.id)
      const next = sourceFromNode(result.node)
      setSource(next)
      latestRef.current = next
      lastSavedRef.current = next
      revisionRef.current = result.node.content_revision ?? 0
      setCanvas(parseJsonCanvas(next))
      onSaved(result.node)
      setSaveState('clean')
    } catch { setSaveState('conflict') }
  }

  function fitCanvas(): void {
    const surface = surfaceRef.current
    if (!surface) return
    const fitted = Math.max(.5, Math.min(1, (surface.clientWidth - 32) / bounds.width))
    setZoom(Math.round(fitted * 100) / 100)
    surface.scrollTo?.({ left: 0, top: 0 })
  }

  function addNode(type: JsonCanvasNode['type']): void {
    if (!canvas) return
    const height = type === 'group' ? 300 : 180
    const width = type === 'group' ? 420 : 280
    const position = nextOpenPosition(canvas.nodes, width, height)
    const next: JsonCanvasNode = {
      height,
      id: id(type),
      type,
      width,
      ...position,
      ...(type === 'text' ? { text: '新文本卡片' } : {}),
      ...(type === 'file' ? { file: 'Note.md' } : {}),
      ...(type === 'link' ? { url: 'https://example.com' } : {}),
      ...(type === 'group' ? { label: '新分组' } : {}),
    }
    commit({ ...canvas, nodes: [...canvas.nodes, next] })
    setSelectedIds([next.id])
    setSelectedEdgeId(null)
    setNotice('已选 1 个卡片。按住 Shift 再选一个。')
    requestAnimationFrame(() => {
      const element = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>('[data-canvas-node-id]') ?? [])
        .find((candidate) => candidate.dataset.canvasNodeId === next.id)
      element?.scrollIntoView?.({ block: 'center', inline: 'center' })
      element?.focus({ preventScroll: true })
    })
  }

  function updateNode(nodeId: string, patch: Partial<JsonCanvasNode>): void {
    if (!canvas) return
    commit({ ...canvas, nodes: canvas.nodes.map((item) => item.id === nodeId ? { ...item, ...patch } : item) })
  }

  function removeSelection(): void {
    if (!canvas) return
    setDeletedSnapshot(canvas)
    if (selectedEdgeId) {
      commit({ ...canvas, edges: canvas.edges.filter((edge) => edge.id !== selectedEdgeId) }, true)
      setSelectedEdgeId(null)
      setNotice('连接已删除。')
      return
    }
    const removing = new Set(selectedIds)
    commit({
      ...canvas,
      edges: canvas.edges.filter((edge) => !removing.has(edge.fromNode) && !removing.has(edge.toNode)),
      nodes: canvas.nodes.filter((item) => !removing.has(item.id)),
    }, true)
    setSelectedIds([])
    setNotice('所选卡片已删除。')
  }

  function undoDeletion(): void {
    if (!deletedSnapshot) return
    const snapshot = deletedSnapshot
    commit(snapshot)
    setNotice('已撤销删除。')
  }

  function connectSelection(): void {
    if (!canvas) return
    if (selectedIds.length !== 2) {
      setNotice('先选择一个卡片，再按住 Shift 选择第二个卡片。')
      return
    }
    const [fromNode, toNode] = selectedIds
    const exists = canvas.edges.some((edge) =>
      (edge.fromNode === fromNode && edge.toNode === toNode) ||
      (edge.fromNode === toNode && edge.toNode === fromNode),
    )
    if (exists) {
      setNotice('这两个卡片已经连接。')
      return
    }
    commit({ ...canvas, edges: [...canvas.edges, { fromNode, id: id('edge'), label: '', toNode }] })
    setSelectedIds([])
    setSelectedEdgeId(null)
    setNotice('连接已建立。')
  }

  function arrangeCanvas(): void {
    if (!canvas || canvas.nodes.length < 2) return
    commit({
      ...canvas,
      nodes: canvas.nodes.map((item, index) => ({
        ...item,
        ...gridPosition(index),
      })),
    })
    clearSelection()
    setNotice('画布已整理，卡片内容和连接保持不变。')
    requestAnimationFrame(fitCanvas)
  }

  function selectNode(nodeId: string, additive: boolean): void {
    setDeletedSnapshot(null)
    setSelectedEdgeId(null)
    const next = additive
      ? (selectedIds.includes(nodeId) ? selectedIds.filter((value) => value !== nodeId) : [...selectedIds, nodeId].slice(-2))
      : [nodeId]
    setSelectedIds(next)
    setNotice(next.length === 2
      ? '已选 2 个卡片，可以点击“连接所选”。'
      : next.length === 1 ? '已选 1 个卡片。按住 Shift 再选一个。' : null)
  }

  function clearSelection(): void {
    setDeletedSnapshot(null)
    setSelectedIds([])
    setSelectedEdgeId(null)
    setNotice(null)
  }

  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (selectedIds.length || selectedEdgeId) {
        event.preventDefault()
        clearSelection()
      }
      return
    }
    if (disabled || node.status === 'streaming') return
    const movement = {
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
    }[event.key]
    if (movement && selectedIds.length && canvas) {
      event.preventDefault()
      const step = event.shiftKey ? 40 : 10
      const selected = new Set(selectedIds)
      commit({
        ...canvas,
        nodes: canvas.nodes.map((item) => selected.has(item.id)
          ? { ...item, x: item.x + movement.x * step, y: item.y + movement.y * step }
          : item),
      })
      setNotice(`已移动 ${selectedIds.length} 个卡片；按住 Shift 可快速移动。`)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedIds.length || selectedEdgeId)) {
      event.preventDefault()
      removeSelection()
    }
  }

  function beginDrag(event: ReactPointerEvent, item: JsonCanvasNode): void {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: item.id, pointerX: event.clientX, pointerY: event.clientY, startX: item.x, startY: item.y }
    selectNode(item.id, event.shiftKey)
  }

  function drag(event: ReactPointerEvent): void {
    const active = dragRef.current
    if (!active || !canvas) return
    const dx = (event.clientX - active.pointerX) / zoom
    const dy = (event.clientY - active.pointerY) / zoom
    setCanvas({
      ...canvas,
      nodes: canvas.nodes.map((item) => item.id === active.id
        ? { ...item, x: Math.round(active.startX + dx), y: Math.round(active.startY + dy) }
        : item),
    })
  }

  function endDrag(): void {
    if (!dragRef.current || !canvas) return
    dragRef.current = null
    commit(canvas)
  }

  function openCanvasFile(path?: string): void {
    const target = Object.values(nodesById).find((item) => item.is_deleted === 0 && item.file_path === path)
    if (!target) {
      setNotice('当前笔记库中找不到这个文件。')
      return
    }
    useWorkbench.getState().setMain(target.id)
  }

  const selectedNode = canvas?.nodes.find((item) => item.id === selectedIds[0])
  const selectedEdge = canvas?.edges.find((edge) => edge.id === selectedEdgeId)
  const readonly = disabled || node.status === 'streaming'
  return (
    <section className="document-editor canvas-editor" data-save-state={saveState} data-testid="doc-view">
      <header className="document-editor-chrome canvas-editor-chrome">
        <div aria-label="画布查看方式" className="document-view-switch" role="tablist">
          <button aria-selected={mode === 'canvas'} disabled={!canvas} onClick={() => setMode('canvas')} role="tab" type="button">画布</button>
          <button aria-selected={mode === 'source'} onClick={() => setMode('source')} role="tab" type="button">源码（JSON）</button>
        </div>
        {mode === 'canvas' && (
          <div aria-label="画布工具" className="canvas-tools" role="toolbar">
            <button disabled={readonly} onClick={() => addNode('text')} type="button"><Icon name="plus" />文本</button>
            <button disabled={readonly} onClick={() => addNode('file')} type="button"><Icon name="plus" />文件</button>
            <button disabled={readonly} onClick={() => addNode('link')} type="button"><Icon name="plus" />链接</button>
            <button disabled={readonly} onClick={() => addNode('group')} type="button"><Icon name="plus" />分组</button>
            <button disabled={readonly || (canvas?.nodes.length ?? 0) < 2} onClick={arrangeCanvas} type="button">整理画布</button>
            <button disabled={readonly || (canvas?.nodes.length ?? 0) < 2} onClick={connectSelection} type="button">连接所选</button>
            <button disabled={readonly || (!selectedIds.length && !selectedEdgeId)} onClick={removeSelection} type="button">删除</button>
          </div>
        )}
        <span className="document-file-path" title={node.file_path ?? undefined}>{node.file_path ?? '本地画布文件（.canvas）'}</span>
        <SaveIndicator state={saveState} />
      </header>
      {saveState === 'conflict' && <div className="document-save-error" role="alert"><span>磁盘上的 Canvas 已变化。</span><button onClick={() => { void loadDiskVersion() }} type="button">加载磁盘版本</button></div>}
      {mode === 'canvas' && notice && (
        <div className="canvas-action-notice" role="status">
          <span>{notice}</span>
          {deletedSnapshot && <button onClick={undoDeletion} type="button">撤销</button>}
        </div>
      )}
      {mode === 'source' ? (
        <div className="canvas-source-editor">
          {!canvas && <div className="document-save-error" role="alert">JSON Canvas 结构无效。修复后才能切回画布。</div>}
          <CodeMirror
            aria-label="JSON Canvas 源码"
            basicSetup={{ bracketMatching: true, closeBrackets: true, foldGutter: true, lineNumbers: true }}
            editable={!readonly}
            extensions={[EditorView.lineWrapping]}
            minHeight="560px"
            onChange={(value) => {
              setSource(value)
              latestRef.current = value
              const parsed = parseJsonCanvas(value)
              setCanvas(parsed)
              setSaveState(parsed ? 'dirty' : 'error')
              if (parsed) scheduleSave(value)
            }}
            value={source}
          />
        </div>
      ) : canvas && (
        <div className="canvas-workspace">
          <div className="canvas-zoom-controls">
            <button aria-label="缩小画布" onClick={() => setZoom((value) => Math.max(.4, value - .1))} type="button"><Icon name="minus" /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button aria-label="放大画布" onClick={() => setZoom((value) => Math.min(1.8, value + .1))} type="button"><Icon name="plus" /></button>
            <button onClick={fitCanvas} type="button">适配</button>
          </div>
          <div
            aria-label="Canvas 画布区域"
            className="json-canvas-viewport"
            onClick={(event) => {
              const target = event.target as HTMLElement
              if (!target.closest('.json-canvas-node') && !target.closest('.json-canvas-edges g')) clearSelection()
            }}
            onKeyDown={handleCanvasKeyDown}
            ref={surfaceRef}
            tabIndex={0}
          >
            <div
              className="json-canvas-world"
              onPointerMove={drag}
              onPointerUp={endDrag}
              style={{ height: bounds.height * zoom, width: bounds.width * zoom }}
            >
              <div
                className="json-canvas-stage"
                style={{ height: bounds.height, transform: `scale(${zoom})`, width: bounds.width }}
              >
                <svg aria-label="Canvas 连线" className="json-canvas-edges" height={bounds.height} width={bounds.width}>
                  {canvas.edges.map((edge) => {
                    const from = canvas.nodes.find((item) => item.id === edge.fromNode)
                    const to = canvas.nodes.find((item) => item.id === edge.toNode)
                    if (!from || !to) return null
                    const start = center(from)
                    const end = center(to)
                    return (
                      <g className={edge.id === selectedEdgeId ? 'is-selected' : ''} key={edge.id} onClick={() => { setSelectedEdgeId(edge.id); setSelectedIds([]) }}>
                        <line x1={start.x - bounds.minX + 48} x2={end.x - bounds.minX + 48} y1={start.y - bounds.minY + 48} y2={end.y - bounds.minY + 48} />
                        {edge.label && <text x={(start.x + end.x) / 2 - bounds.minX + 48} y={(start.y + end.y) / 2 - bounds.minY + 40}>{edge.label}</text>}
                      </g>
                    )
                  })}
                </svg>
                {canvas.nodes.map((item) => (
                  <article
                    aria-label={`${canvasNodeTypeLabel(item.type)}：${canvasNodeSummary(item)}`}
                    className={`json-canvas-node is-${item.type}${selectedIds.includes(item.id) ? ' is-selected' : ''}`}
                    data-canvas-node-id={item.id}
                    key={item.id}
                    onClick={(event) => selectNode(item.id, event.shiftKey)}
                    onKeyDown={(event) => {
                      if ((event.target as HTMLElement).closest('button, a, input, textarea')) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectNode(item.id, event.shiftKey)
                      }
                    }}
                    style={{
                      height: item.height,
                      left: item.x - bounds.minX + 48,
                      top: item.y - bounds.minY + 48,
                      width: item.width,
                    }}
                    tabIndex={0}
                  >
                    <button aria-label={`拖动${canvasNodeTypeLabel(item.type)}：${canvasNodeSummary(item)}`} className="json-canvas-node-handle" onPointerDown={(event) => beginDrag(event, item)} type="button">
                      <span>{item.type === 'text' ? '文本' : item.type === 'file' ? '文件' : item.type === 'link' ? '链接' : '分组'}</span>
                      <span aria-hidden="true">⠿</span>
                    </button>
                    <div className="json-canvas-node-content">
                      {item.type === 'text' && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text || '空文本') }} />}
                      {item.type === 'file' && (
                        <button
                          className="json-canvas-file-button"
                          disabled={!Object.values(nodesById).some((candidate) => candidate.is_deleted === 0 && candidate.file_path === item.file)}
                          onClick={(event) => { event.stopPropagation(); openCanvasFile(item.file) }}
                          title={Object.values(nodesById).some((candidate) => candidate.is_deleted === 0 && candidate.file_path === item.file) ? '打开这篇笔记' : '未在当前笔记库找到该文件'}
                          type="button"
                        >
                          <strong>{item.file || '未选择文件'}</strong>
                          {item.subpath && <span>{item.subpath}</span>}
                        </button>
                      )}
                      {item.type === 'link' && (safeCanvasUrl(item.url)
                        ? <a href={safeCanvasUrl(item.url)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{item.url}</a>
                        : <span>{item.url || '未设置链接'}</span>)}
                      {item.type === 'group' && <strong>{item.label || '未命名分组'}</strong>}
                    </div>
                  </article>
                ))}
                {canvas.nodes.length === 0 && (
                  <div className="canvas-empty-state">
                    <strong>这块画布还是空的</strong>
                    <span>从上方添加文本、文件、链接或分组。选中两个卡片后可以建立连接。</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {(selectedNode || selectedEdge) && (
            <aside aria-label="Canvas 检查器" className="canvas-inspector">
              <button aria-label="关闭属性面板" className="canvas-inspector-close" onClick={clearSelection} type="button"><Icon name="close" /></button>
              {selectedNode && <NodeInspector disabled={readonly} fileOptions={fileOptions} node={selectedNode} onChange={(patch) => updateNode(selectedNode.id, patch)} />}
              {selectedEdge && <EdgeInspector disabled={readonly} edge={selectedEdge} onChange={(patch) => commit({ ...canvas, edges: canvas.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, ...patch } : edge) })} />}
            </aside>
          )}
        </div>
      )}
    </section>
  )
})

function NodeInspector({ disabled, fileOptions, node, onChange }: { disabled: boolean; fileOptions: string[]; node: JsonCanvasNode; onChange(patch: Partial<JsonCanvasNode>): void }) {
  const safeUrl = safeCanvasUrl(node.url)
  const fileIsMissing = node.type === 'file' && Boolean(node.file) && !fileOptions.includes(node.file ?? '')
  const fileListId = `canvas-files-${node.id}`
  return (
    <div>
      <strong>{node.type === 'text' ? '文本卡片' : node.type === 'file' ? '文件卡片' : node.type === 'link' ? '链接卡片' : '分组'}</strong>
      {node.type === 'text' && <label><span>内容（Markdown）</span><textarea disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} value={node.text ?? ''} /></label>}
      {node.type === 'file' && <>
        <label>
          <span>笔记库中的文件</span>
          <input disabled={disabled} list={fileListId} onChange={(event) => onChange({ file: event.target.value })} placeholder="从列表选择或输入相对路径" value={node.file ?? ''} />
          <datalist id={fileListId}>{fileOptions.map((path) => <option key={path} value={path} />)}</datalist>
        </label>
        {fileOptions.length === 0 && <p className="canvas-field-help">当前笔记库还没有可选文件，也可以手动输入相对路径。</p>}
        {fileIsMissing && <p className="canvas-field-help is-error" role="alert">当前笔记库中找不到这个文件，请检查路径。</p>}
        <label><span>定位到标题或段落（可选）</span><input disabled={disabled} onChange={(event) => onChange({ subpath: event.target.value })} value={node.subpath ?? ''} /></label>
      </>}
      {node.type === 'link' && <>
        <label><span>网址</span><input disabled={disabled} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://example.com" value={node.url ?? ''} /></label>
        {node.url && !safeUrl && <p className="canvas-field-help is-error" role="alert">仅支持 http、https 或 mailto 链接。</p>}
        {safeUrl && <a className="canvas-inspector-open-link" href={safeUrl} rel="noreferrer" target="_blank">打开链接 ↗</a>}
      </>}
      {node.type === 'group' && <label><span>分组名称</span><input disabled={disabled} onChange={(event) => onChange({ label: event.target.value })} value={node.label ?? ''} /></label>}
      <details className="canvas-geometry-details">
        <summary>位置与尺寸</summary>
        <div className="canvas-geometry-fields">
          {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}><span>{key}</span><input disabled={disabled} min={key === 'width' || key === 'height' ? 40 : undefined} onChange={(event) => onChange({ [key]: Number(event.target.value) })} type="number" value={node[key]} /></label>)}
        </div>
      </details>
    </div>
  )
}

function EdgeInspector({ disabled, edge, onChange }: { disabled: boolean; edge: JsonCanvasEdge; onChange(patch: Partial<JsonCanvasEdge>): void }) {
  return <div><strong>连接</strong><label><span>关系标签</span><input disabled={disabled} onChange={(event) => onChange({ label: event.target.value })} value={edge.label ?? ''} /></label></div>
}
