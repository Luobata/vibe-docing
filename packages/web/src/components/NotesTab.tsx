import type { AnnotationRow } from '@vibe/shared'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { useWorkbench } from '../state/workbench-store'
import { ImageThumbs } from './ImageThumbs'
import { ImageDiscardConfirm } from './ChatBox'

export function NotesTab({ annotations, onJump, onCreateNote, canCreateNote }: {
  annotations: AnnotationRow[]
  onJump(annotationId: string): void
  onCreateNote(note: string): void | Promise<void>
  canCreateNote: boolean
}) {
  const [value, setValue] = useState('')
  const [flashId, setFlashId] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const anchoredNoteId = useWorkbench((s) => s.anchoredNoteId)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const { images, removeImage, clear, handlePaste, handleDrop } = usePastedImages(mainNodeId)
  const notes = annotations.filter((a) => a.child_node_id === null && a.note)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.max(56, Math.min(input.scrollHeight, 160))}px`
  }, [value])

  // One-shot anchor highlight: flash + scroll the matching note, then clear the
  // store flag so re-anchoring the same note later re-triggers (like focusedAnnotationId).
  useEffect(() => {
    if (!anchoredNoteId) return
    setFlashId(anchoredNoteId)
    const el = listRef.current?.querySelector(`[data-note-id="${anchoredNoteId}"]`)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    useWorkbench.getState().setAnchoredNoteId(null)
  }, [anchoredNoteId])

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1200)
    return () => clearTimeout(t)
  }, [flashId])

  async function commit(note: string, discardImages: boolean): Promise<void> {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = onCreateNote(note)
      if (result) await result
      if (discardImages) clear()
      setValue('')
      setPendingNote(null)
    } catch {
      setPendingNote(null)
      setSubmitError('笔记保存失败，文字和图片均已保留。')
      setTimeout(() => inputRef.current?.focus(), 0)
    } finally {
      setSubmitting(false)
    }
  }

  function requestSubmit(): void {
    if (!canCreateNote || submitting) return
    const note = value.trim()
    if (!note) return
    if (images.length > 0) { setPendingNote(note); return }
    void commit(note, false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    requestSubmit()
  }

  return (
    <div className="notes-tab">
      <div className="new-note">
        <ImageThumbs images={images} onRemove={removeImage} />
        {pendingNote && <ImageDiscardConfirm busy={submitting} onCancel={() => setPendingNote(null)} onConfirm={() => { void commit(pendingNote, true) }} returnFocusRef={inputRef} />}
        {submitError && <p className="inline-error image-submit-error" role="alert">{submitError}</p>}
        <textarea
          aria-label="新笔记内容"
          disabled={!canCreateNote || submitting}
          onChange={(event) => setValue(event.target.value)}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="记一条笔记…  Enter 保存 / Shift+Enter 换行 · 可粘贴图片"
          ref={inputRef}
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
                  {n.quoted_text && <span className="note-quote">{n.quoted_text}</span>}
                  {n.visual_target && <span className="note-context">可视化 · {n.visual_target.target === 'whole' ? '整图' : '图中元素'}</span>}
                  <span className="note-body">{n.note}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
