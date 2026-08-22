import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { useWorkbench } from '../state/workbench-store'
import { ImageDiscardConfirm } from './ChatBox'
import { ImageThumbs } from './ImageThumbs'

export function QuestionEditor({ question, disabled, onResubmit, testId }: {
  question: string; disabled?: boolean; onResubmit(next: string): void | Promise<void>; testId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(question)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const imgs = usePastedImages(mainNodeId)
  const [pendingValue, setPendingValue] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setValue(question)
    setPendingValue(null)
    setSubmitError(null)
  }, [mainNodeId, question])

  // Measure overflow only while collapsed; keep canExpand sticky when expanded
  // (removing the clamp would otherwise make the "收起" toggle vanish mid-read).
  useLayoutEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (el) setCanExpand(el.scrollHeight > el.clientHeight + 1)
  }, [question, expanded])

  async function commit(next: string, discardImages: boolean): Promise<void> {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = onResubmit(next)
      if (result) await result
      if (discardImages) imgs.clear()
      setPendingValue(null)
      setEditing(false)
    } catch {
      setPendingValue(null)
      setSubmitError('重新生成失败，文字和图片均已保留。')
      setTimeout(() => editorRef.current?.focus(), 0)
    } finally {
      setSubmitting(false)
    }
  }

  function submit(): void {
    if (disabled || submitting) return
    const next = value.trim()
    if (!next) return
    if (imgs.images.length > 0) {
      setPendingValue(next)
      return
    }
    void commit(next, false)
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
        <button
          aria-label="编辑问题并重新生成"
          className="quiet-button"
          disabled={disabled}
          onClick={() => { if (!disabled) { setValue(question); setEditing(true) } }}
          title="保存后会用新问题重新生成正文"
          type="button"
        >
          编辑并重新生成
        </button>
      </div>
    )
  }
  return (
    <div className="question-editor">
      <textarea aria-label="edit-question" autoFocus onChange={(e) => setValue(e.target.value)}
        onDrop={imgs.handleDrop} onKeyDown={onKeyDown} onPaste={imgs.handlePaste} ref={editorRef} value={value} />
      <ImageThumbs images={imgs.images} onRemove={imgs.removeImage} />
      {pendingValue && (
        <ImageDiscardConfirm
          busy={submitting}
          onCancel={() => setPendingValue(null)}
          onConfirm={() => { void commit(pendingValue, true) }}
          returnFocusRef={editorRef}
        />
      )}
      {submitError && <p className="inline-error image-submit-error" role="alert">{submitError}</p>}
      <div className="question-editor-actions">
        <button className="primary-button" disabled={disabled || submitting || !value.trim()} onClick={submit} type="button">{submitting ? '提交中…' : '保存并重新生成'}</button>
        <button className="quiet-button" disabled={submitting} onClick={cancel} type="button">取消</button>
      </div>
    </div>
  )
}
