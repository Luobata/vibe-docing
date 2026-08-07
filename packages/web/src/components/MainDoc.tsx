import {
  plainTextToProseMirror,
  type AnnotationRow,
  type ContextSegmentRow,
  type NodeRow,
} from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import type { PlainSelection } from '../doc/selection'
import { useAutoScroll } from '../flow/use-auto-scroll'
import { useWorkbench } from '../state/workbench-store'
import { AnnotationBubble } from './AnnotationBubble'
import { AssistantStatus } from './AssistantStatus'
import { ChatBox } from './ChatBox'
import { DocView } from './DocView'
import { MergedConclusions } from './MergedConclusions'

interface Turn {
  answer: NodeRow
  id: string
  question: string
}

type Phase = 'idle' | 'replying' | 'thinking'

function humanize(message: string): string {
  const m = message.trim()
  if (/HTTP\s*(401|403)/.test(m)) return '模型鉴权失败，请到设置检查 API Key。'
  if (/HTTP\s*4\d\d/.test(m)) return '请求有误，请稍后重试。'
  if (/HTTP\s*5\d\d/.test(m) || /answer failed/i.test(m)) return '生成失败，可能是模型服务不稳定，请重试。'
  if (/fetch|network|Failed to fetch/i.test(m)) return '网络异常，请检查连接后重试。'
  return '生成中断，请重试。'
}

export function MainDoc() {
  const api = useApi()
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const treeId = useWorkbench((state) => state.treeId)
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const [segments, setSegments] = useState<ContextSegmentRow[]>([])
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<PlainSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [lastTurnNodeId, setLastTurnNodeId] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const stopRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamSignature =
    transcript.length +
    ':' +
    (transcript[transcript.length - 1]?.answer.ai_response?.length ?? 0)
  const { scrollToBottom, showButton } = useAutoScroll(scrollRef, streamSignature)

  useEffect(() => {
    let active = true
    setAnnotations([])
    setSegments([])
    setSelection(null)
    setError(null)
    setTranscript([])
    setLastTurnNodeId(null)
    setPhase('idle')
    stopRef.current = false
    if (!mainNodeId) return () => { active = false }
    const getNode = (api as Partial<Api>).getNode
    if (!getNode) return () => { active = false }
    void getNode(mainNodeId)
      .then((result) => {
        if (!active) return
        setAnnotations(result.annotations)
        setSegments(result.segments)
        upsertNode(result.node)
      })
      .catch(() => {
        if (active) setError('无法刷新文档详情，正在显示本地内容。')
      })
    return () => { active = false }
  }, [api, mainNodeId, upsertNode])

  if (!mainNodeId) return <div className="document-placeholder" data-testid="main-doc-empty">← 先在左上角输入标题并新建一棵树，选中节点后即可在下方对话生成内容</div>
  const node = nodesById[mainNodeId]
  if (!node) return <div className="inline-error" role="alert">当前文档不存在</div>

  function patchLastTurn(patch: Partial<NodeRow>): void {
    setTranscript((turns) => {
      if (turns.length === 0) return turns
      const last = turns[turns.length - 1]
      return [...turns.slice(0, -1), { ...last, answer: { ...last.answer, ...patch } }]
    })
  }

  async function forkExpand(question: string): Promise<void> {
    if (!selection || !treeId) return
    setError(null)
    try {
      const result = await api.fork(node.id, {
        anchorFrom: selection.from,
        anchorTo: selection.to,
        kind: 'selection',
        quotedText: selection.text,
        seedText: question,
        treeId,
      })
      setAnnotations((current) => [...current, result.annotation])
      const childId = result.childNode.id
      const openSubdocTab = useWorkbench.getState().openSubdocTab
      upsertNode({ ...result.childNode, status: 'streaming', user_input: question })
      openSubdocTab(childId)
      setSelection(null)
      // Design §4③ step 4: the forked child must hold the conversation itself,
      // otherwise it is left permanently empty. Answer it with the seed question.
      let text = ''
      await api.streamAnswer(childId, question, {
        onChunk(chunk) {
          text += chunk
          upsertNode({ ...result.childNode, ai_response: plainTextToProseMirror(text), status: 'streaming', user_input: question })
        },
        onDone: upsertNode,
        onError(message) {
          upsertNode({ ...result.childNode, status: 'error', user_input: question })
          setError(`生成中断：${message}`)
        },
      })
    } catch {
      setError('分叉创建失败，请稍后重试。')
    }
  }

  async function runTurn(answerId: string, question: string): Promise<void> {
    let text = ''
    await api.streamAnswer(answerId, question, {
      onChunk(chunk) {
        if (stopRef.current) return
        setPhase('replying')
        text += chunk
        patchLastTurn({ ai_response: plainTextToProseMirror(text), status: 'streaming' })
      },
      onDone(doneNode) {
        if (stopRef.current) return
        patchLastTurn({ ...doneNode, status: doneNode.status ?? 'complete' })
        setPhase('idle')
      },
      onError(message) {
        if (stopRef.current) return
        patchLastTurn({ status: 'error' })
        setError(humanize(message))
        setPhase('idle')
      },
    })
  }

  // Answer the current node itself (used for the first question on an empty node,
  // so we don't leave an empty root behind and fork a child needlessly).
  async function answerInPlace(targetId: string, question: string): Promise<void> {
    const prepared = await api.editNode(targetId, { userInput: question })
    let text = ''
    upsertNode({ ...prepared.node, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: question })
    await api.streamAnswer(targetId, question, {
      onChunk(chunk) {
        if (stopRef.current) return
        setPhase('replying')
        text += chunk
        upsertNode({ ...prepared.node, ai_response: plainTextToProseMirror(text), status: 'streaming', user_input: question })
      },
      onDone(doneNode) {
        if (stopRef.current) return
        upsertNode({ ...doneNode, status: doneNode.status ?? 'complete' })
        setPhase('idle')
      },
      onError(message) {
        if (stopRef.current) return
        upsertNode({ ...prepared.node, status: 'error', user_input: question })
        setError(humanize(message))
        setPhase('idle')
      },
    })
  }

  async function ask(question: string): Promise<void> {
    if (!treeId || busy) return
    // Linear conversation. The first question on an empty node fills that node
    // itself (no empty root left behind). Once a node already holds an answer,
    // follow-ups fork from the previous turn's answer (or the current node), so
    // the backend's ancestor-full segments carry history. Turns are local state
    // only — never setMain / openSubdocTab, never pollute the tree/subdoc tabs.
    const currentIsEmpty = !node.user_input && !node.ai_response
    setBusy(true)
    setError(null)
    setPhase('thinking')
    setLastQuestion(question)
    stopRef.current = false
    try {
      if (transcript.length === 0 && lastTurnNodeId === null && currentIsEmpty) {
        setLastTurnNodeId(node.id)
        await answerInPlace(node.id, question)
        return
      }
      const parentId = lastTurnNodeId ?? node.id
      const forked = await api.fork(parentId, {
        anchorFrom: null,
        anchorTo: null,
        kind: 'whole',
        quotedText: null,
        seedText: question,
        treeId,
      })
      const prepared = await api.editNode(forked.childNode.id, { userInput: question })
      const answerId = prepared.node.id
      setLastTurnNodeId(answerId)
      setTranscript((turns) => [...turns, {
        answer: { ...prepared.node, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: question },
        id: answerId,
        question,
      }])
      await runTurn(answerId, question)
    } catch (cause) {
      if (!stopRef.current) setError(cause instanceof Error ? humanize(cause.message) : '提问失败，请重试。')
      setPhase('idle')
    } finally {
      setBusy(false)
    }
  }

  async function retryLastTurn(): Promise<void> {
    if (busy || !lastQuestion) return
    if (!lastTurnNodeId) { void ask(lastQuestion); return }
    setBusy(true)
    setError(null)
    setPhase('thinking')
    stopRef.current = false
    patchLastTurn({ status: 'streaming' })
    try {
      await runTurn(lastTurnNodeId, lastQuestion)
    } catch (cause) {
      if (!stopRef.current) setError(cause instanceof Error ? humanize(cause.message) : '重试失败，请重试。')
      setPhase('idle')
    } finally {
      setBusy(false)
    }
  }

  function stop(): void {
    stopRef.current = true
    setPhase('idle')
    setBusy(false)
    patchLastTurn({ status: 'complete' })
  }

  async function retryCurrent(): Promise<void> {
    const question = node.user_input?.trim()
    if (!question || busy) return
    let text = ''
    setBusy(true)
    setError(null)
    upsertNode({ ...node, status: 'streaming' })
    try {
      await api.streamAnswer(node.id, question, {
        onChunk(chunk) {
          text += chunk
          upsertNode({ ...node, ai_response: plainTextToProseMirror(text), status: 'streaming' })
        },
        onDone: upsertNode,
        onError(message) { setError(`生成中断：${message}`) },
      })
    } catch {
      setError('重试失败，请检查 Provider 设置。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="main-doc-content">
      <div className="main-doc-scroll" data-testid="conversation-scroll" ref={scrollRef}>
        <DocView annotations={annotations} node={node} onRetry={() => { void retryCurrent() }} onSelect={setSelection} />
        <MergedConclusions segments={segments} />
        {transcript.map((turn, index) => (
          <section aria-label="对话轮次" className="turn" key={turn.id}>
            <p className="turn-question" data-testid="turn-question">{turn.question}</p>
            <DocView
              annotations={[]}
              errorText={index === transcript.length - 1 && error ? error : undefined}
              node={turn.answer}
              onRetry={() => { void retryLastTurn() }}
              onSelect={() => {}}
            />
          </section>
        ))}
        {selection && (
          <AnnotationBubble
            onCreateNote={() => setSelection(null)}
            onDismiss={() => setSelection(null)}
            onForkExpand={(question) => { void forkExpand(question) }}
            selection={selection}
          />
        )}
        {error && transcript.length === 0 && <p className="inline-error" role="alert">{error}</p>}
      </div>
      {showButton && (
        <button className="scroll-to-bottom" data-testid="scroll-to-bottom" onClick={scrollToBottom} type="button">
          ↓ 回到底部
        </button>
      )}
      <div className="composer">
        {phase !== 'idle' && <AssistantStatus onStop={stop} phase={phase} />}
        <ChatBox disabled={busy} onSubmit={(question) => { void ask(question) }} />
      </div>
    </div>
  )
}
