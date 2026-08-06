import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'

const MAX_HEIGHT = 200

interface PastedImage {
  id: string
  name: string
  url: string
}

export function ChatBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit(question: string): void
}) {
  const [question, setQuestion] = useState('')
  const [images, setImages] = useState<PastedImage[]>([])
  const [showHint, setShowHint] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const seq = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [question])

  useEffect(() => () => {
    // Revoke any outstanding object URLs when the composer unmounts.
    for (const image of images) URL.revokeObjectURL(image.url)
  }, [images])

  function addImageFiles(files: FileList | File[]): void {
    const picked: PastedImage[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      seq.current += 1
      picked.push({ id: `img-${seq.current}`, name: file.name, url: URL.createObjectURL(file) })
    }
    if (picked.length) setImages((current) => [...current, ...picked])
  }

  function removeImage(id: string): void {
    setImages((current) => {
      const target = current.find((image) => image.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return current.filter((image) => image.id !== id)
    })
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = event.clipboardData?.files
    if (files && files.length) addImageFiles(files)
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>): void {
    const files = event.dataTransfer?.files
    if (files && files.length) {
      event.preventDefault()
      addImageFiles(files)
    }
  }

  function submit(): void {
    const value = question.trim()
    if (disabled || !value) return
    if (images.length > 0) {
      // v1: images are a local note only — the model still receives plain text.
      setShowHint(true)
      for (const image of images) URL.revokeObjectURL(image.url)
      setImages([])
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
      {images.length > 0 && (
        <div className="chat-images">
          {images.map((image) => (
            <span className="chat-image-thumb" data-testid="chat-image-thumb" key={image.id}>
              <img alt={image.name} src={image.url} />
              <button aria-label="移除图片" onClick={() => removeImage(image.id)} type="button">×</button>
            </span>
          ))}
        </div>
      )}
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
