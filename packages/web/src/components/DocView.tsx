import { prosemirrorToPlainText, type AnnotationRow, type NodeRow } from '@vibe/shared'
import { useRef } from 'react'
import { splitByAnnotations } from '../doc/highlight'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const text = prosemirrorToPlainText(node.ai_response)
  const ranges = annotations.flatMap((annotation) => {
    if ('from' in annotation) return [annotation]
    return annotation.anchor_from === null || annotation.anchor_to === null
      ? []
      : [{ from: annotation.anchor_from, id: annotation.id, to: annotation.anchor_to }]
  })
  const runs = splitByAnnotations(text, ranges)

  function captureSelection(): void {
    if (!containerRef.current) return
    const selection = getPlainSelection(containerRef.current)
    if (selection) onSelect(selection)
  }

  return (
    <div className="doc-view-shell">
      <div
        className="doc-view"
        data-testid="doc-view"
        onKeyUp={captureSelection}
        onMouseUp={captureSelection}
        ref={containerRef}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {runs.map((run, index) =>
          run.annId ? (
            <mark data-ann-id={run.annId} key={`${run.annId}:${index}`}>{run.text}</mark>
          ) : (
            <span key={`plain:${index}`}>{run.text}</span>
          ),
        )}
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
