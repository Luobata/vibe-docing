import type { AnnotationRow } from '@vibe/shared'

export function NotesTab({ annotations, onJump }: {
  annotations: AnnotationRow[]; onJump(annotationId: string): void
}) {
  const notes = annotations.filter((a) => a.child_node_id === null && a.note)
  if (notes.length === 0) return <p className="empty-state">还没有笔记</p>
  return (
    <ul className="notes-list">
      {notes.map((n) => (
        <li className="note-item" key={n.id}>
          <button onClick={() => onJump(n.id)} type="button">
            {n.quoted_text && <blockquote>{n.quoted_text}</blockquote>}
            <span className="note-body">{n.note}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
