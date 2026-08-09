import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'

export function QuestionEditor({ question, disabled, onResubmit, testId }: {
  question: string; disabled?: boolean; onResubmit(next: string): void; testId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(question)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const imgs = usePastedImages()

  // Measure overflow only while collapsed; keep canExpand sticky when expanded
  // (removing the clamp would otherwise make the "收起" toggle vanish mid-read).
  useLayoutEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (el) setCanExpand(el.scrollHeight > el.clientHeight + 1)
  }, [question, expanded])

  function submit(): void {
    if (disabled) return
    const next = value.trim()
    if (!next) return
    onResubmit(next)
    imgs.clear()
    setEditing(false)
  }
  function cancel(): void { setValue(question); imgs.clear(); setEditing(false) }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
    e.preventDefault()
    if (disabled) return
    submit()
  }

  if (!editing) {
    const base = testId === 'turn-question' ? 'question-text turn-question' : 'question-text'
    const textClass = expanded ? base : `${base} question-text--clamped`
    return (
      <div className="question-view">
        <div className="question-main">
          <span className={textClass} data-testid={testId} ref={textRef}>{question}</span>
          {canExpand && (
            <button className="question-toggle" onClick={() => setExpanded((v) => !v)} type="button">
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
        <button aria-label="编辑问题" className="quiet-button" disabled={disabled}
          onClick={() => { if (!disabled) { setValue(question); setEditing(true) } }} type="button">编辑</button>
      </div>
    )
  }
  return (
    <div className="question-editor">
      <textarea aria-label="edit-question" autoFocus onChange={(e) => setValue(e.target.value)}
        onDrop={imgs.handleDrop} onKeyDown={onKeyDown} onPaste={imgs.handlePaste} value={value} />
      <ImageThumbs images={imgs.images} onRemove={imgs.removeImage} />
      <div className="question-editor-actions">
        <button className="primary-button" disabled={disabled || !value.trim()} onClick={submit} type="button">保存并重新生成</button>
        <button className="quiet-button" onClick={cancel} type="button">取消</button>
      </div>
    </div>
  )
}
