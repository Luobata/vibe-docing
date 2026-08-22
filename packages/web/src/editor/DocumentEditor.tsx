import type { AnnotationRow, NodeRow, VisualReference } from '@vibe/shared'
import { forwardRef } from 'react'
import type { PlainSelection } from '../doc/selection'
import { CanvasEditor } from './CanvasEditor'
import { MarkdownEditor } from './MarkdownEditor'

export interface DocumentEditorHandle {
  flush(): Promise<void>
  focus(): void
}

export interface DocumentEditorProps {
  annotations: AnnotationRow[]
  disabled?: boolean
  errorText?: string
  node: NodeRow
  onAnchorClick?(annotationId: string): void
  onContextSelect?(selection: PlainSelection, x: number, y: number): void
  onRetry?(): void
  onSaved(node: NodeRow): void
  onSelect(selection: PlainSelection): void
  onVisualAnnotate?(reference: VisualReference, from: number, to: number): void
}

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor(props, ref) {
    return props.node.file_kind === 'canvas'
      ? <CanvasEditor {...props} ref={ref} />
      : <MarkdownEditor {...props} ref={ref} />
  },
)
