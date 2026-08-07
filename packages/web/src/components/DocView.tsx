import { prosemirrorToPlainText, type AnnotationRow, type NodeRow } from '@vibe/shared'
import { useRef } from 'react'
import type { AnnotationRange } from '../doc/highlight'
import { renderAnnotatedHtml } from '../doc/markdown'
import { getPlainSelection, type PlainSelection } from '../doc/selection'

export function DocView({
  annotations,
  errorText,
  node,
  onRetry,
  onSelect,
}: {
  annotations: Array<AnnotationRow | { from: number; id: string; to: number }>
  errorText?: string
  node: NodeRow
  onRetry(): void
  onSelect(selection: PlainSelection): void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const text = prosemirrorToPlainText(node.ai_response)
  const ranges: AnnotationRange[] = annotations.flatMap((annotation) => {
    if ('from' in annotation) return [annotation]
    return annotation.anchor_from === null || annotation.anchor_to === null
      ? []
      : [{ from: annotation.anchor_from, id: annotation.id, to: annotation.anchor_to }]
  })
  const html = renderAnnotatedHtml(text, ranges)

  function captureSelection(): void {
    if (!bodyRef.current) return
    const selection = getPlainSelection(bodyRef.current)
    if (selection) onSelect(selection)
  }

  return (
    <div className="doc-view-shell">
      <div className="doc-view" data-testid="doc-view">
        <div
          className="doc-body"
          dangerouslySetInnerHTML={{ __html: html }}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          ref={bodyRef}
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
    </div>
  )
}
