import { useState, type KeyboardEvent } from 'react'
import type { PlainSelection } from '../doc/selection'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'

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
  onCreateNote(note: string): void
  onDismiss(): void
  onForkExpand(question: string): void
  selection: PlainSelection
}) {
  const [note, setNote] = useState('')
  const [question, setQuestion] = useState('')
  const noteImgs = usePastedImages()
  const forkImgs = usePastedImages()

  return (
    <div aria-label="批注操作" className="annotation-bubble" role="dialog">
      <blockquote>{selection.text}</blockquote>
      <label>
        <span>笔记</span>
        <textarea
          aria-label="note"
          autoFocus={initialFocus !== 'expand'}
          onChange={(event) => setNote(event.target.value)}
          onDrop={noteImgs.handleDrop}
          onKeyDown={(e) => submitKey(e, () => { if (note.trim()) { onCreateNote(note.trim()); noteImgs.clear() } })}
          onPaste={noteImgs.handlePaste}
          placeholder="记下判断或待验证事项"
          value={note}
        />
      </label>
      <ImageThumbs images={noteImgs.images} onRemove={noteImgs.removeImage} />
      <button
        disabled={!note.trim()}
        onClick={() => { onCreateNote(note.trim()); noteImgs.clear() }}
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
          onKeyDown={(e) => submitKey(e, () => { if (question.trim()) { onForkExpand(question.trim()); forkImgs.clear() } })}
          onPaste={forkImgs.handlePaste}
          placeholder={`围绕“${selection.text.slice(0, 24)}”继续追问`}
          value={question}
        />
      </label>
      <ImageThumbs images={forkImgs.images} onRemove={forkImgs.removeImage} />
      <div className="bubble-actions">
        <button
          disabled={!question.trim()}
          onClick={() => { onForkExpand(question.trim()); forkImgs.clear() }}
          type="button"
        >
          就此展开
        </button>
        <button onClick={onDismiss} type="button">取消</button>
      </div>
    </div>
  )
}
