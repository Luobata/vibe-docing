import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'

const MAX_HEIGHT = 200

export function ChatBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit(question: string): void
}) {
  const [question, setQuestion] = useState('')
  const [showHint, setShowHint] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const { images, removeImage, clear, handlePaste, handleDrop } = usePastedImages()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [question])

  function submit(): void {
    const value = question.trim()
    if (disabled || !value) return
    if (images.length > 0) {
      // v1: images are a local note only — the model still receives plain text.
      setShowHint(true)
      clear()
    }
    onSubmit(value)
    setQuestion('')
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
      {showHint && (
        <p className="image-degrade-hint" data-testid="image-degrade-hint">图片仅本地保存，模型暂不读图。</p>
      )}
      <div className="chat-box">
        <textarea
          aria-label="chat-input"
          disabled={disabled}
          onChange={(event) => setQuestion(event.target.value)}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="继续追问…  Enter 发送 / Shift+Enter 换行 · 可粘贴图片"
          ref={ref}
          value={question}
        />
        <button disabled={disabled || !question.trim()} onClick={submit} type="button">
          {disabled ? '生成中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
