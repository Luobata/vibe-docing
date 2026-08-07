import { useState } from 'react'
import type { PlainSelection } from '../doc/selection'

export function AnnotationBubble({
  initialFocus,
  onCreateNote,
  onDismiss,
  onForkExpand,
  selection,
}: {
  initialFocus?: 'note' | 'expand'
  onCreateNote(note: string): void
  onDismiss(): void
  onForkExpand(question: string): void
  selection: PlainSelection
}) {
  const [note, setNote] = useState('')
  const [question, setQuestion] = useState('')

  return (
    <div aria-label="批注操作" className="annotation-bubble" role="dialog">
      <blockquote>{selection.text}</blockquote>
      <label>
        <span>笔记</span>
        <textarea
          aria-label="note"
          autoFocus={initialFocus !== 'expand'}
          onChange={(event) => setNote(event.target.value)}
          placeholder="记下判断或待验证事项"
          value={note}
        />
      </label>
      <button disabled={!note.trim()} onClick={() => onCreateNote(note.trim())} type="button">
        保存笔记
      </button>
      <label>
        <span>就此展开</span>
        <textarea
          aria-label="fork-question"
          autoFocus={initialFocus === 'expand'}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={`围绕“${selection.text.slice(0, 24)}”继续追问`}
          value={question}
        />
      </label>
      <div className="bubble-actions">
        <button disabled={!question.trim()} onClick={() => onForkExpand(question.trim())} type="button">
          就此展开
        </button>
        <button onClick={onDismiss} type="button">取消</button>
      </div>
    </div>
  )
}
