import { documentContentOf, prosemirrorToPlainText, prosemirrorToRenderRuns, type AnnotationRow, type NodeRow, type VisualReference } from '@vibe/shared'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useCodeEnhancements } from '../doc/highlight-code'
import type { AnnotationRange } from '../doc/highlight'
import { renderAnnotatedHtml } from '../doc/markdown'
import { getPlainSelection, type PlainSelection } from '../doc/selection'
import { VisualBlockView } from './VisualBlockView'

export function DocView({
  annotations,
  errorText,
  generationTaskKey,
  node,
  onAnchorClick,
  onContextSelect,
  onRetry,
  onSelect,
  onVisualAnnotate,
  retryDisabled = false,
  retryTaskKey,
}: {
  annotations: Array<AnnotationRow | { from: number; id: string; to: number }>
  errorText?: string
  generationTaskKey?: string
  node: NodeRow
  onAnchorClick?(annotationId: string): void
  onContextSelect?(selection: PlainSelection, x: number, y: number): void
  onRetry(taskKey: string): void
  onSelect(selection: PlainSelection): void
  onVisualAnnotate?(reference: VisualReference, from: number, to: number): void
  retryDisabled?: boolean
  retryTaskKey?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [subdocTitleCanExpand, setSubdocTitleCanExpand] = useState(false)
  const [subdocTitleExpanded, setSubdocTitleExpanded] = useState(false)
  const documentContent = documentContentOf(node)
  // 渲染路径缓存（契约 Q1-c 第 1 类）：documentContent 是原始字符串（Object.is
  // 稳定），流式 token 之外的重渲染不再逐 run 重算 markdown+批注。
  const text = useMemo(() => prosemirrorToPlainText(documentContent), [documentContent])
  const ranges: AnnotationRange[] = useMemo(() => annotations.flatMap((annotation) => {
    if ('from' in annotation) return [annotation]
    return annotation.anchor_from === null || annotation.anchor_to === null
      ? []
      : [{ from: annotation.anchor_from, id: annotation.id, to: annotation.anchor_to }]
  }), [annotations])
  const runs = useMemo(() => prosemirrorToRenderRuns(documentContent), [documentContent])
  const annotatedHtml = useMemo(
    () => runs.map((run) => {
      if (run.type !== 'text') return null
      return renderAnnotatedHtml(run.text, ranges.flatMap((range) => {
        const from = Math.max(range.from, run.start)
        const to = Math.min(range.to, run.end)
        return from < to ? [{ ...range, from: from - run.start, to: to - run.start }] : []
      }))
    }),
    [runs, ranges],
  )
  // 代码块增强（契约 Q1-c 第 2 类）：内容变化后接线复制按钮与异步语法高亮。
  useCodeEnhancements(bodyRef, [annotatedHtml])
  const resolvedGenerationTaskKey = generationTaskKey ?? `retry:${node.id}`
  const resolvedRetryTaskKey = retryTaskKey ?? `retry:${node.id}`

  function selectionPoint(): { x: number; y: number } | null {
    const nativeSelection = window.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) return null
    const range = nativeSelection.getRangeAt(0)
    if (!bodyRef.current?.contains(range.commonAncestorContainer)) return null
    const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
    const rect = rects[rects.length - 1] ??
      (typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : bodyRef.current.getBoundingClientRect())
    return { x: rect.left + rect.width / 2, y: rect.top }
  }

  function captureSelection(openMenu = false): PlainSelection | null {
    if (!bodyRef.current) return null
    const selection = getPlainSelection(bodyRef.current)
    if (!selection) return null
    onSelect(selection)
    if (openMenu && onContextSelect) {
      const point = selectionPoint()
      if (point) onContextSelect(selection, point.x, point.y)
    }
    return selection
  }

  useLayoutEffect(() => {
    const card = bodyRef.current?.closest<HTMLElement>('.subdoc-card')
    const heading = card?.querySelector<HTMLElement>('h3')
    if (!card || !heading) {
      setSubdocTitleCanExpand(false)
      return
    }
    const title = node.user_input?.split('\n')[0]?.trim() || '未命名'
    heading.title = title
    const canExpand = title.length > 28 || heading.scrollHeight > heading.clientHeight + 1
    setSubdocTitleCanExpand(canExpand)
    card.classList.toggle('is-title-expanded', subdocTitleExpanded)
    return () => card.classList.remove('is-title-expanded')
  }, [node.user_input, subdocTitleExpanded])

  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (!bodyRef.current || !onContextSelect) return
    const selection = getPlainSelection(bodyRef.current)
    if (!selection) return
    event.preventDefault()
    onContextSelect(selection, event.clientX, event.clientY)
  }

  function handleSelectionKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'F10' || !event.shiftKey || !onContextSelect) return
    const selection = captureSelection(false)
    const point = selectionPoint()
    if (!selection || !point) return
    event.preventDefault()
    onContextSelect(selection, point.x, point.y)
  }

  return (
    <div className="doc-view-shell">
      {subdocTitleCanExpand && (
        <button
          aria-expanded={subdocTitleExpanded}
          className="subdoc-title-toggle"
          onClick={() => setSubdocTitleExpanded((expanded) => !expanded)}
          type="button"
        >
          {subdocTitleExpanded ? '收起标题' : '展开标题'}
        </button>
      )}
      <div className="doc-view" data-testid="doc-view">
        <div
          className="doc-body"
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest('[data-ann-id]')
            const id = el?.getAttribute('data-ann-id')
            if (id && onAnchorClick) onAnchorClick(id)
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={handleSelectionKeyDown}
          onKeyUp={() => captureSelection(true)}
          onMouseUp={() => {
            requestAnimationFrame(() => captureSelection(true))
          }}
          ref={bodyRef}
          tabIndex={0}
        >
          {runs.map((run, index) => {
            if (run.type === 'text') return (
              <div
                className="doc-text-run"
                data-canonical-text={run.text}
                data-text-end={run.end}
                data-text-start={run.start}
                dangerouslySetInnerHTML={{ __html: annotatedHtml[index] ?? '' }}
                key={`text-${index}`}
              />
            )
            const visualAnnotations = annotations.filter((annotation): annotation is AnnotationRow =>
              'visual_target' in annotation
              && annotation.visual_target?.artifactId === run.reference.artifactId
              && annotation.visual_target.revision === run.reference.revision)
            return (
              <div
                className={`doc-visual-run${visualAnnotations.length ? ' is-annotated' : ''}`}
                data-canonical-text={`${run.reference.altText}\n`}
                data-text-end={run.end}
                data-text-start={run.start}
                key={`${run.reference.artifactId}-${run.reference.revision}`}
              >
                <VisualBlockView
                  onAnnotate={onVisualAnnotate ? () => onVisualAnnotate(run.reference, run.start, run.end) : undefined}
                  reference={run.reference}
                />
                {visualAnnotations.length > 0 && (
                  <div aria-label="可视化批注" className="visual-annotation-markers">
                    {visualAnnotations.map((annotation, annotationIndex) => (
                      <button data-ann-id={annotation.id} key={annotation.id} type="button">
                        图批注 {annotationIndex + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {node.status === 'streaming' && (
          <span
            aria-label="正在生成"
            className="streaming-cursor"
            data-gen-status="streaming"
            data-task-key={resolvedGenerationTaskKey}
          >▍</span>
        )}
        {node.status === 'streaming' && text.length === 0 && (
          <span
            className="thinking-hint"
            data-gen-status="streaming"
            data-task-key={resolvedGenerationTaskKey}
          >思考中…</span>
        )}
      </div>
      {node.status === 'error' && (
        <div
          className="inline-error"
          data-gen-status="error"
          data-task-key={resolvedGenerationTaskKey}
          role="alert"
        >
          <span>{errorText ?? '生成中断，已保留当前内容。'}</span>
          <button
            aria-label="retry"
            data-generation-retry="true"
            data-task-key={resolvedRetryTaskKey}
            disabled={retryDisabled}
            onClick={() => onRetry(resolvedRetryTaskKey)}
            type="button"
          >重试</button>
        </div>
      )}
      {node.status === 'cancelled' && (
        <div
          className="cancelled-generation"
          data-gen-status="cancelled"
          data-task-key={resolvedGenerationTaskKey}
          role="status"
        >
          <span>已停止生成</span>
          <button
            data-generation-retry="true"
            data-task-key={resolvedRetryTaskKey}
            disabled={retryDisabled}
            onClick={() => onRetry(resolvedRetryTaskKey)}
            type="button"
          >重新生成</button>
        </div>
      )}
    </div>
  )
}
