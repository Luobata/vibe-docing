import { validateVisualArtifact, validateVisualReference, type VisualArtifact, type VisualReference } from '@vibe/shared'
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { useApi } from '../api/context'
import { getVisualRenderer } from '../visual/renderer-registry'
import { sceneLayout } from '../visual/scene-layout'
import { visualRuntimeStore } from '../visual/visual-stream-state'

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export function VisualBlockView({ reference, artifact: suppliedArtifact, onAnnotate, onRetry }: {
  reference: VisualReference
  artifact?: VisualArtifact
  onAnnotate?(): void
  onRetry?(): void
}) {
  const api = useApi()
  const checkedReference = validateVisualReference(reference)
  const runtime = useSyncExternalStore(visualRuntimeStore.subscribe, visualRuntimeStore.getSnapshot, visualRuntimeStore.getSnapshot)
  const runtimeEntry = Object.values(runtime).find((entry) => entry.artifactId === reference.artifactId && entry.revision === reference.revision)
  const [loadedArtifact, setLoadedArtifact] = useState<VisualArtifact>()
  const [loadFailed, setLoadFailed] = useState(false)
  const candidate = suppliedArtifact ?? (runtimeEntry?.status === 'ready' ? runtimeEntry.artifact : undefined) ?? loadedArtifact
  const checkedArtifact = candidate ? validateVisualArtifact(candidate) : undefined
  const artifact = checkedArtifact?.success ? checkedArtifact.value : undefined
  const unknownRenderer = candidate !== undefined
    && typeof (candidate as { renderer?: unknown }).renderer === 'string'
    && !getVisualRenderer((candidate as { renderer: string }).renderer)
  const error = runtimeEntry?.status === 'error' || loadFailed || (candidate !== undefined && !artifact && !unknownRenderer)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const dialogViewportRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number }>()
  const layout = useMemo(() => artifact ? sceneLayout(artifact) : undefined, [artifact])

  useEffect(() => {
    setZoom(100)
    setPan({ x: 0, y: 0 })
    setLoadedArtifact(undefined)
    setLoadFailed(false)
  }, [reference.artifactId, reference.revision])

  useEffect(() => {
    if (!checkedReference.success || candidate || runtimeEntry?.status === 'loading' || runtimeEntry?.status === 'error') return
    let active = true
    void api.getVisualArtifact(reference.artifactId, reference.revision).then(({ artifact: next }) => {
      if (active) setLoadedArtifact(next)
    }).catch(() => {
      if (active) setLoadFailed(true)
    })
    return () => { active = false }
  }, [api, candidate, checkedReference.success, reference.artifactId, reference.revision, runtimeEntry?.status])

  if (!checkedReference.success) return null
  const altText = checkedReference.value.altText
  const Renderer = artifact ? getVisualRenderer(artifact.renderer) : undefined
  const reset = (): void => { setZoom(100); setPan({ x: 0, y: 0 }) }
  const setZoomBy = (delta: number): void => setZoom((value) => clampZoom(value + delta))
  const isOverflowing = (): boolean => [viewportRef.current, dialogViewportRef.current].some((viewport) =>
    !!viewport && (viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight)) || zoom > 100
  const openFullscreen = (): void => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLElement>('button')?.focus()
  }
  const closeFullscreen = (): void => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
    fullscreenButtonRef.current?.focus()
  }
  const handleKeys = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault()
      event.key === '0' ? reset() : setZoomBy(event.key === '-' ? -ZOOM_STEP : ZOOM_STEP)
      return
    }
    if (event.key === 'Enter') { event.preventDefault(); openFullscreen(); return }
    if (event.key === 'Escape' && dialogRef.current?.hasAttribute('open')) { event.preventDefault(); closeFullscreen(); return }
    if (event.key.startsWith('Arrow') && isOverflowing()) {
      event.preventDefault()
      const step = event.shiftKey ? 72 : 24
      setPan((value) => ({
        x: value.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        y: value.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
      }))
    }
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isOverflowing()) return
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag) setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y })
  }
  const trapDialogFocus = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); closeFullscreen(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  if (error) return <figure className="visual-block visual-error">
    <div role="alert">可视化暂时无法显示。正文内容已保留。</div><p>{altText}</p>
    {onRetry && <button onClick={onRetry} type="button">重试</button>}
  </figure>
  if (unknownRenderer) return <figure className="visual-block visual-fallback"><p>{altText}</p></figure>
  if (!artifact) return <figure className="visual-block visual-loading" role="status">
    <div aria-hidden="true" className="visual-skeleton"><span /><span /><span /></div><span>正在生成可视化</span>
  </figure>
  if (!Renderer || !layout) return <figure className="visual-block visual-fallback"><p>{altText}</p></figure>

  const renderCanvas = (ref: RefObject<HTMLDivElement>) => <div
    aria-label={artifact.altText}
    className="visual-viewport"
    onKeyDown={handleKeys}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={() => { dragRef.current = undefined }}
    ref={ref}
    role="img"
    tabIndex={0}
  >
    <div className="visual-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}>
      <RendererBoundary fallback={altText}><Renderer artifact={artifact} layout={layout} /></RendererBoundary>
    </div>
  </div>

  return <figure className="visual-block">
    {renderCanvas(viewportRef)}
    <figcaption>{artifact.title}</figcaption>
    <div aria-label="可视化工具栏" className="visual-toolbar" role="toolbar">
      <button aria-label="缩小" disabled={zoom === MIN_ZOOM} onClick={() => setZoomBy(-ZOOM_STEP)} type="button">−</button>
      <output>{zoom}%</output>
      <button aria-label="放大" disabled={zoom === MAX_ZOOM} onClick={() => setZoomBy(ZOOM_STEP)} type="button">+</button>
      <button onClick={reset} type="button">适应视图</button>
      {onAnnotate && <button onClick={onAnnotate} type="button">批注整图</button>}
      <button onClick={openFullscreen} ref={fullscreenButtonRef} type="button">全屏</button>
    </div>
    <dialog aria-label={artifact.title} className="visual-dialog" onCancel={(event) => { event.preventDefault(); closeFullscreen() }} onKeyDown={trapDialogFocus} ref={dialogRef}>
      <button autoFocus onClick={closeFullscreen} type="button">关闭</button>
      {renderCanvas(dialogViewportRef)}
    </dialog>
  </figure>
}

class RendererBoundary extends Component<{ children: ReactNode; fallback: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render() { return this.state.failed ? <p className="visual-renderer-fallback">{this.props.fallback}</p> : this.props.children }
}
