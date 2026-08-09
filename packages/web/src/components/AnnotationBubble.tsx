import { useRef, useState, type KeyboardEvent } from 'react'
import type { PlainSelection } from '../doc/selection'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'
import { ImageDiscardConfirm } from './ChatBox'

function submitKey(e: KeyboardEvent, run: () => void) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
  e.preventDefault()
  run()
}

export function AnnotationBubble({
  initialFocus,
  onCreateNote,
  onDismiss,
  onForkExpand,
  selection,
}: {
  initialFocus?: 'note' | 'expand'
  onCreateNote(note: string): void | Promise<void>
  onDismiss(): void
  onForkExpand(question: string): void | Promise<void>
  selection: PlainSelection
}) {
  const [note, setNote] = useState('')
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<'fork' | 'note' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const forkRef = useRef<HTMLTextAreaElement>(null)
  const noteImgs = usePastedImages()
  const forkImgs = usePastedImages()

  async function commit(kind: 'fork' | 'note'): Promise<void> {
    const value = kind === 'note' ? note.trim() : question.trim()
    const imgs = kind === 'note' ? noteImgs : forkImgs
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = kind === 'note' ? onCreateNote(value) : onForkExpand(value)
      if (result) await result
      imgs.clear()
      if (kind === 'note') setNote('')
      else setQuestion('')
      setPending(null)
    } catch {
      setPending(null)
      setSubmitError('提交失败，文字和图片均已保留。')
      setTimeout(() => (kind === 'note' ? noteRef.current : forkRef.current)?.focus(), 0)
    } finally {
      setSubmitting(false)
    }
  }

  function submitNote(): void {
    if (!note.trim()) return
    if (noteImgs.images.length > 0) { setPending('note'); return }
    void commit('note')
  }
  function submitFork(): void {
    if (!question.trim()) return
    if (forkImgs.images.length > 0) { setPending('fork'); return }
    void commit('fork')
  }

  return (
    <div
      aria-label="批注操作"
      className="annotation-bubble"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || pending) return
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }}
      role="dialog"
    >
      <blockquote>{selection.text}</blockquote>
      <label>
        <span>笔记</span>
        <textarea
          aria-label="note"
          autoFocus={initialFocus !== 'expand'}
          onChange={(event) => setNote(event.target.value)}
          onDrop={noteImgs.handleDrop}
          onKeyDown={(e) => submitKey(e, submitNote)}
          onPaste={noteImgs.handlePaste}
          placeholder="记下判断或待验证事项"
          ref={noteRef}
          value={note}
        />
      </label>
      <ImageThumbs images={noteImgs.images} onRemove={noteImgs.removeImage} />
      {pending === 'note' && <ImageDiscardConfirm busy={submitting} onCancel={() => setPending(null)} onConfirm={() => { void commit('note') }} returnFocusRef={noteRef} />}
      <button
        disabled={submitting || !note.trim()}
        onClick={submitNote}
        type="button"
      >
        保存笔记
      </button>
      <label>
        <span>就此展开</span>
        <textarea
          aria-label="fork-question"
          autoFocus={initialFocus === 'expand'}
          onChange={(event) => setQuestion(event.target.value)}
          onDrop={forkImgs.handleDrop}
          onKeyDown={(e) => submitKey(e, submitFork)}
          onPaste={forkImgs.handlePaste}
          placeholder={`围绕“${selection.text.slice(0, 24)}”继续追问`}
          ref={forkRef}
          value={question}
        />
      </label>
      <ImageThumbs images={forkImgs.images} onRemove={forkImgs.removeImage} />
      {pending === 'fork' && <ImageDiscardConfirm busy={submitting} onCancel={() => setPending(null)} onConfirm={() => { void commit('fork') }} returnFocusRef={forkRef} />}
      {submitError && <p className="inline-error image-submit-error" role="alert">{submitError}</p>}
      <div className="bubble-actions">
        <button
          disabled={submitting || !question.trim()}
          onClick={submitFork}
          type="button"
        >
          就此展开
        </button>
        <button onClick={onDismiss} type="button">取消</button>
      </div>
    </div>
  )
}
