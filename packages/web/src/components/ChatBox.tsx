import { useState, type KeyboardEvent } from 'react'

export function ChatBox({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit(question: string): void
}) {
  const [question, setQuestion] = useState('')

  function submit(): void {
    const value = question.trim()
    if (disabled || !value) return
    onSubmit(value)
    setQuestion('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat-box">
      <textarea
        aria-label="chat-input"
        disabled={disabled}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="继续追问…  Ctrl/⌘ + Enter 发送"
        value={question}
      />
      <button disabled={disabled || !question.trim()} onClick={submit} type="button">
        {disabled ? '生成中…' : '发送'}
      </button>
    </div>
  )
}
