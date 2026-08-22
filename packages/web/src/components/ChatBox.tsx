import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { useWorkbench } from '../state/workbench-store'
import { ImageThumbs } from './ImageThumbs'
import { Icon } from './Icon'

const MAX_HEIGHT = 200
export const IMAGE_DISCARD_MESSAGE = '图片不会发送给模型，也不会保存。确认后将只提交文字。'

export function ImageDiscardConfirm({
  busy = false,
  onCancel,
  onConfirm,
  returnFocusRef,
}: {
  busy?: boolean
  onCancel(): void
  onConfirm(): void
  returnFocusRef: RefObject<HTMLElement>
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  function cancel(): void {
    onCancel()
    setTimeout(() => returnFocusRef.current?.focus(), 0)
  }

  return (
    <div
      aria-label="确认仅提交文字"
      aria-modal="false"
      className="image-discard-confirm"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }}
      role="alertdialog"
    >
      <p>{IMAGE_DISCARD_MESSAGE}</p>
      <div className="image-discard-actions">
        <button autoFocus disabled={busy} onClick={onConfirm} ref={confirmRef} type="button">
          {busy ? '提交中…' : '仅提交文字'}
        </button>
        <button disabled={busy} onClick={cancel} type="button">返回编辑</button>
      </div>
    </div>
  )
}

export function ChatBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit(question: string): void | Promise<void>
}) {
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  return <ChatBoxComposer disabled={disabled} key={mainNodeId ?? 'no-main-node'} mainNodeId={mainNodeId} onSubmit={onSubmit} />
}

function ChatBoxComposer({ disabled, mainNodeId, onSubmit }: {
  disabled: boolean
  mainNodeId: string | null
  onSubmit(question: string): void | Promise<void>
}) {
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const { images, removeImage, clear, handlePaste, handleDrop } = usePastedImages(mainNodeId)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [question])

  // 会话地图「＋ 新建分支」派发 vibe:focus-ask：聚焦提问输入框
  useEffect(() => {
    const focusAsk = (): void => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.scrollIntoView?.({ block: 'nearest' })
    }
    window.addEventListener('vibe:focus-ask', focusAsk)
    return () => window.removeEventListener('vibe:focus-ask', focusAsk)
  }, [])

  async function commit(value: string, discardImages: boolean): Promise<void> {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = onSubmit(value)
      if (result) await result
      if (discardImages) clear()
      setQuestion('')
      setPendingQuestion(null)
    } catch {
      setPendingQuestion(null)
      setSubmitError('提交失败，文字和图片均已保留，请重试。')
      setTimeout(() => ref.current?.focus(), 0)
    } finally {
      setSubmitting(false)
    }
  }

  function submit(): void {
    const value = question.trim()
    if (disabled || submitting || !value) return
    if (images.length > 0) {
      setPendingQuestion(value)
      return
    }
    void commit(value, false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <div className="chat-box-wrap">
      <ImageThumbs images={images} onRemove={removeImage} />
      {pendingQuestion && (
        <ImageDiscardConfirm
          busy={submitting}
          onCancel={() => setPendingQuestion(null)}
          onConfirm={() => { void commit(pendingQuestion, true) }}
          returnFocusRef={ref}
        />
      )}
      {submitError && <p className="inline-error image-submit-error" role="alert">{submitError}</p>}
      <div className="chat-box">
        <textarea
          aria-label="chat-input"
          disabled={disabled || submitting}
          onChange={(event) => setQuestion(event.target.value)}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="让 AI 基于当前笔记继续思考…  Enter 发送 / Shift+Enter 换行"
          ref={ref}
          value={question}
        />
        <button disabled={disabled || submitting || !question.trim()} onClick={submit} type="button">
          <Icon name="send" size={14} />{disabled ? '生成中…' : submitting ? '提交中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
