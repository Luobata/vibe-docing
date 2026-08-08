import type { AnnotationRow } from '@vibe/shared'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { useWorkbench } from '../state/workbench-store'
import { ImageThumbs } from './ImageThumbs'

export function NotesTab({ annotations, onJump, onCreateNote }: {
  annotations: AnnotationRow[]
  onJump(annotationId: string): void
  onCreateNote(note: string): void
}) {
  const [value, setValue] = useState('')
  const [flashId, setFlashId] = useState<string | null>(null)
  const anchoredNoteId = useWorkbench((s) => s.anchoredNoteId)
  const listRef = useRef<HTMLUListElement>(null)
  const { images, removeImage, clear, handlePaste, handleDrop } = usePastedImages()
  const notes = annotations.filter((a) => a.child_node_id === null && a.note)

  // One-shot anchor highlight: flash + scroll the matching note, then clear the
  // store flag so re-anchoring the same note later re-triggers (like focusedAnnotationId).
  useEffect(() => {
    if (!anchoredNoteId) return
    setFlashId(anchoredNoteId)
    const el = listRef.current?.querySelector(`[data-note-id="${anchoredNoteId}"]`)
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    useWorkbench.getState().setAnchoredNoteId(null)
  }, [anchoredNoteId])

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1200)
    return () => clearTimeout(t)
  }, [flashId])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    const note = value.trim()
    if (!note) return
    onCreateNote(note)
    setValue('')
    clear()
  }

  return (
    <div className="notes-tab">
      <div className="new-note">
        <ImageThumbs images={images} onRemove={removeImage} />
        <textarea
          aria-label="new-note-input"
          onChange={(event) => setValue(event.target.value)}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="记一条笔记…  Enter 保存 / Shift+Enter 换行 · 可粘贴图片"
          value={value}
        />
      </div>
      {notes.length === 0
        ? <p className="empty-state">还没有笔记</p>
        : (
          <ul className="notes-list" ref={listRef}>
            {notes.map((n) => (
              <li
                className={`note-item${flashId === n.id ? ' ann-flash' : ''}`}
                data-note-id={n.id}
                key={n.id}
              >
                <button onClick={() => onJump(n.id)} type="button">
                  {n.quoted_text && <blockquote>{n.quoted_text}</blockquote>}
                  <span className="note-body">{n.note}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
