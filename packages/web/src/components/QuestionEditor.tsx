import { useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'

export function QuestionEditor({ question, disabled, onResubmit }: {
  question: string; disabled?: boolean; onResubmit(next: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(question)
  const imgs = usePastedImages()

  function submit(): void {
    const next = value.trim()
    if (!next) return
    onResubmit(next)
    imgs.clear()
    setEditing(false)
  }
  function cancel(): void { setValue(question); imgs.clear(); setEditing(false) }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
    e.preventDefault(); submit()
  }

  if (!editing) {
    return (
      <div className="question-view">
        <span className="question-text">{question}</span>
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
        <button className="primary-button" disabled={!value.trim()} onClick={submit} type="button">保存并重新生成</button>
        <button className="quiet-button" onClick={cancel} type="button">取消</button>
      </div>
    </div>
  )
}
