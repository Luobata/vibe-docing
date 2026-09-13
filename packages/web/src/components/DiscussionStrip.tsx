import type { NodeRow } from '@vibe/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, type DiscussionMessage, type DiscussionMove, type DiscussionStep, type DiscussionStreamHandlers } from '../api/client'
import { useApi } from '../api/context'
import { useCodeEnhancements } from '../doc/highlight-code'
import { renderMarkdown } from '../doc/markdown'
import { useWorkbench } from '../state/workbench-store'
import { Icon, type IconName } from './Icon'

const MOVES: Array<{ move: DiscussionMove; label: string; icon: IconName }> = [
  { move: 'challenge', label: '反驳我', icon: 'alert' },
  { move: 'perspectives', label: '三视角', icon: 'map' },
  { move: 'converge', label: '收敛', icon: 'density' },
]
interface Draft extends DiscussionStep { text: string }
const PERSONAS = ['架构师', '保守派', '用户代言人']

function personaOf(content: string): string | undefined {
  return PERSONAS.find((persona) => content.trimStart().startsWith(`### ${persona}\n`))
}

function messageError(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'error' in error.payload) {
    return String(error.payload.error)
  }
  return error instanceof Error ? error.message : '请求失败，请重试'
}

function MessageBody({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useCodeEnhancements(ref, [content])
  const persona = personaOf(content)
  const source = persona ? content.trimStart().slice(`### ${persona}\n`.length) : content
  return <div className="doc-body discussion-message-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} ref={ref} />
}

export function DiscussionStrip({ node, onSaved }: { node: NodeRow; onSaved(node: NodeRow): void }) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'stream' | 'child' | 'section' | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const active = useRef(true)
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    active.current = true
    let current = true
    void (async () => {
      try {
        const result = await api.listDiscussion(node.id)
        if (current) setMessages(result.messages)
      } catch (cause) {
        if (current) setError(`无法加载讨论：${messageError(cause)}`)
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => { current = false; active.current = false; controllerRef.current?.abort() }
  }, [api, node.id])

  useEffect(() => {
    const list = listRef.current
    if (open && list) list.scrollTop = list.scrollHeight
  }, [open, messages, drafts])

  function reconcile(saved: DiscussionMessage[]) {
    setMessages(saved)
    setDrafts((current) => current.filter((draft) => !saved.some((message) => message.role === 'assistant' && message.content === draft.text)))
  }

  async function send(move?: DiscussionMove) {
    const text = move ? MOVES.find((item) => item.move === move)!.label : input.trim()
    if (!text || busyRef.current || loading) return
    busyRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy('stream')
    setStatus('思考中…')
    setError(null)
    setDrafts([])
    if (!move) setInput('')
    setMessages((current) => [...current, {
      id: `pending-${Date.now()}`, node_id: node.id, role: 'user', content: text,
      created_at: '', promoted_node_id: null, promoted_mode: null,
    }])
    let reconciled = false
    const live = () => active.current && !controller.signal.aborted
    const handlers: DiscussionStreamHandlers = {
      onChunk(chunk, step) {
        if (!live()) return
        setStatus('正在回复…')
        setDrafts((current) => {
          const last = current.at(-1)
          return last && last.step === step.step
            ? [...current.slice(0, -1), { ...last, text: last.text + chunk }]
            : [...current, { ...step, text: chunk }]
        })
      },
      onPing() { if (live()) setStatus('思考中 · 连接正常') },
      onDone(saved) {
        if (!live()) return
        reconciled = true
        setMessages(saved)
        setDrafts([])
        setStatus('')
      },
      onError(message, detail) {
        if (!live()) return
        setError(`${detail?.step ? `第 ${detail.step} 步${detail.persona ? `（${detail.persona}）` : ''}：` : ''}${message}`)
        if (detail?.messages) { reconciled = true; reconcile(detail.messages) }
        setStatus('')
      },
      onCancelled() { if (active.current) setStatus('已停止，未完成的回复尚未保存') },
    }
    try {
      if (move) await api.runDiscussionMove(node.id, move, handlers, controller.signal)
      else await api.sendDiscussion(node.id, text, handlers, controller.signal)
    } catch (cause) {
      if (live()) { setError(messageError(cause)); setStatus('') }
    } finally {
      if (active.current) { setBusy(null); busyRef.current = false }
      if (active.current && !reconciled) {
        try {
          const saved = await api.listDiscussion(node.id)
          if (active.current && controllerRef.current === controller) reconcile(saved.messages)
        } catch { /* Keep the visible transcript if a disconnected request cannot reload. */ }
      }
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  async function promote(mode: 'child' | 'section') {
    if (busyRef.current || !selected.length) return
    busyRef.current = true
    setBusy(mode)
    setError(null)
    try {
      const body = { mode, messageIds: selected, ...(mode === 'section' ? { baseRevision: node.content_revision ?? 0 } : {}) }
      let result
      try { result = await api.promoteDiscussion(node.id, body) } catch (cause) {
        if (mode !== 'section' || !(cause instanceof ApiError) || cause.status !== 409) throw cause
        const latest = await api.getNode(node.id)
        onSaved(latest.node)
        result = await api.promoteDiscussion(node.id, { ...body, baseRevision: latest.node.content_revision ?? 0 })
      }
      onSaved(result.node)
      useWorkbench.getState().setToast(mode === 'child' ? '已转为子文档' : '已追加为小节，可在版本历史中回退')
      if (active.current) { setMessages(result.messages); setSelected([]) }
    } catch (cause) {
      const message = cause instanceof ApiError && cause.status === 409 ? '内容已变化，请重试' : messageError(cause)
      useWorkbench.getState().setToast(message)
      if (active.current) setError(message)
    } finally {
      if (active.current) { setBusy(null); busyRef.current = false }
    }
  }

  const disabled = busy !== null || loading
  return (
    <section aria-label="文档讨论" className="discussion-strip">
      <button aria-controls={`${id}-panel`} aria-expanded={open} className="discussion-toggle" onClick={() => setOpen(!open)} type="button">
        <span>讨论 ({messages.length})</span><Icon name={open ? 'chevron-down' : 'chevron-right'} />
        {busy === 'stream' && <span className="discussion-toggle-status">思考中…</span>}
      </button>
      {open && <div className="discussion-panel" id={`${id}-panel`}>
        <div aria-label="讨论消息" className="discussion-messages" ref={listRef}>
          {loading && <p className="discussion-empty">正在加载讨论…</p>}
          {!loading && messages.length === 0 && <p className="discussion-empty">围绕这篇文档聊聊，选中有用的回复后可沉淀到文档。</p>}
          {messages.map((message, index) => <article className={`discussion-message is-${message.role}`} key={message.id}>
            <header><span>{message.role === 'user' ? '你' : personaOf(message.content)
              ? <span className="discussion-persona">{PERSONAS.indexOf(personaOf(message.content)!) + 1}. {personaOf(message.content)}</span> : 'AI'}</span>
              {message.role === 'assistant' && <label className="discussion-select">
                <input aria-label={`选择第 ${index + 1} 条回复`} checked={selected.includes(message.id)} disabled={disabled} onChange={(event) => setSelected((current) => event.target.checked ? [...current, message.id] : current.filter((item) => item !== message.id))} type="checkbox" />选择
              </label>}
            </header>
            <MessageBody content={message.content} />
            {message.promoted_mode && <span className="discussion-promoted">已沉淀 → {message.promoted_mode === 'child' ? '子文档' : '小节'}</span>}
          </article>)}
          {drafts.map((draft, index) => <article className="discussion-message is-assistant is-draft" key={index}>
            <header><span>{draft.persona ? <span className="discussion-persona">{draft.step}. {draft.persona}</span> : 'AI'}</span>
              {busy !== 'stream' && <span>未完成 · 未保存</span>}
            </header>
            <MessageBody content={draft.text} />
          </article>)}
        </div>
        {status && <p className="discussion-status" role="status">{status}</p>}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {selected.length > 0 && <div aria-label="沉淀讨论" className="discussion-actions">
          <span>已选 {selected.length} 条</span>
          <button disabled={disabled} onClick={() => { void promote('child') }} type="button"><Icon name="doc" />{busy === 'child' ? '正在沉淀…' : '转为子文档'}</button>
          <button disabled={disabled || node.file_kind === 'canvas' || node.file_kind === 'base'} onClick={() => { void promote('section') }} type="button"><Icon name="plus" />{busy === 'section' ? '正在沉淀…' : '追加为小节'}</button>
        </div>}
        <form className="discussion-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <textarea aria-label="讨论输入" disabled={disabled} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send() }
          }} placeholder="聊聊这篇文档…" rows={2} value={input} />
          <div className="discussion-controls">
            <div className="discussion-moves">{MOVES.map(({ move, label, icon }) => <button disabled={disabled} key={move} onClick={() => { void send(move) }} type="button"><Icon name={icon} />{label}</button>)}</div>
            {busy === 'stream' ? <button onClick={() => controllerRef.current?.abort()} type="button">停止</button>
              : <button disabled={disabled || !input.trim()} type="submit"><Icon name="send" />发送</button>}
          </div>
        </form>
      </div>}
    </section>
  )
}
