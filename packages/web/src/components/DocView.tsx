import { prosemirrorToPlainText, type AnnotationRow, type NodeRow } from '@vibe/shared'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { AnnotationRange } from '../doc/highlight'
import { renderAnnotatedHtml } from '../doc/markdown'
import { getPlainSelection, type PlainSelection } from '../doc/selection'

export function DocView({
  annotations,
  errorText,
  node,
  onAnchorClick,
  onContextSelect,
  onRetry,
  onSelect,
}: {
  annotations: Array<AnnotationRow | { from: number; id: string; to: number }>
  errorText?: string
  node: NodeRow
  onAnchorClick?(annotationId: string): void
  onContextSelect?(selection: PlainSelection, x: number, y: number): void
  onRetry(): void
  onSelect(selection: PlainSelection): void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [subdocTitleCanExpand, setSubdocTitleCanExpand] = useState(false)
  const [subdocTitleExpanded, setSubdocTitleExpanded] = useState(false)
  const text = prosemirrorToPlainText(node.ai_response)
  const ranges: AnnotationRange[] = annotations.flatMap((annotation) => {
    if ('from' in annotation) return [annotation]
    return annotation.anchor_from === null || annotation.anchor_to === null
      ? []
      : [{ from: annotation.anchor_from, id: annotation.id, to: annotation.anchor_to }]
  })
  const html = renderAnnotatedHtml(text, ranges)

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

  useEffect(() => {
    const handleSelectionChange = () => { captureSelection(true) }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  })

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
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest('[data-ann-id]')
            const id = el?.getAttribute('data-ann-id')
            if (id && onAnchorClick) onAnchorClick(id)
          }}
          onContextMenu={handleContextMenu}
          onKeyDown={handleSelectionKeyDown}
          onKeyUp={() => captureSelection(true)}
          onMouseUp={() => captureSelection(true)}
          ref={bodyRef}
          tabIndex={0}
        />
        {node.status === 'streaming' && (
          <span aria-label="正在生成" className="streaming-cursor">▍</span>
        )}
        {node.status === 'streaming' && text.length === 0 && (
          <span className="thinking-hint">思考中…</span>
        )}
      </div>
      {node.status === 'error' && (
        <div className="inline-error" role="alert">
          <span>{errorText ?? '生成中断，已保留当前内容。'}</span>
          <button aria-label="retry" onClick={onRetry} type="button">重试</button>
        </div>
      )}
      {node.status === 'cancelled' && (
        <div className="cancelled-generation" role="status">
          <span>已停止生成</span>
          <button onClick={onRetry} type="button">重新生成</button>
        </div>
      )}
    </div>
  )
}
