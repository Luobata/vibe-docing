import {
  plainTextToProseMirror,
  type AnnotationRow,
  type ContextSegmentRow,
  type NodeRow,
} from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import type { AnswerStreamHandlers, Api } from '../api/client'
import type { RouteCandidate, RouteConvergence } from '../api/types'
import type { PlainSelection } from '../doc/selection'
import { pickAnchorTarget } from '../doc/anchor-target'
import { decideRouteUi, resolveMigrationParent } from '../flow/answer-flow'
import { parallelAsk } from '../flow/parallel-ask'
import { useAutoScroll } from '../flow/use-auto-scroll'
import { useWorkbench } from '../state/workbench-store'
import { AnnotationBubble } from './AnnotationBubble'
import { AssistantStatus } from './AssistantStatus'
import { ChatBox } from './ChatBox'
import { DocView } from './DocView'
import { MergedConclusions } from './MergedConclusions'
import { QuestionEditor } from './QuestionEditor'
import { RouteErrorNotice, RoutePrompt } from './RoutePrompt'
import { SelectionMenu } from './SelectionMenu'

interface Turn {
  answer: NodeRow
  id: string
  question: string
}

interface ActiveGeneration {
  controller: AbortController
  fallbackTimer: ReturnType<typeof setTimeout> | null
  onCancelled(): void
  ownerMainNodeId: string
}

interface PendingRoute {
  answerNodeId: string
  optimisticParentId: string
  question: string
  treeId: string
}

type Phase = 'cancelling' | 'idle' | 'replying' | 'thinking'

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
}

function humanize(message: string): string {
  const m = message.trim()
  if (/HTTP\s*(401|403)/.test(m)) return '模型鉴权失败，请到设置检查 API Key。'
  if (/HTTP\s*4\d\d/.test(m)) return '请求有误，请稍后重试。'
  if (/HTTP\s*5\d\d/.test(m) || /answer failed/i.test(m)) return '生成失败，可能是模型服务不稳定，请重试。'
  if (/fetch|network|Failed to fetch/i.test(m)) return '网络异常，请检查连接后重试。'
  return '生成中断，请重试。'
}

function humanizeRouteError(message: string): string {
  const detail = message.trim()
  return detail
    ? `智能路由暂时不可用：${detail}。本轮回答已保留在当前位置。`
    : '智能路由暂时不可用，本轮回答已保留在当前位置。'
}

export function MainDoc() {
  const api = useApi()
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const treeId = useWorkbench((state) => state.treeId)
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const routeByNodeId = useWorkbench((state) => state.routeByNodeId)
  const setRouteState = useWorkbench((state) => state.setRouteState)
  const setNotesForMain = useWorkbench((state) => state.setNotesForMain)
  const focusedAnnotationId = useWorkbench((state) => state.focusedAnnotationId)
  const mergeRefreshTick = useWorkbench((state) => state.mergeRefreshTick)
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const [segments, setSegments] = useState<ContextSegmentRow[]>([])
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<PlainSelection | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [bubbleMode, setBubbleMode] = useState<'note' | 'expand' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [lastTurnNodeId, setLastTurnNodeId] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  const [pendingRoute, setPendingRoute] = useState<PendingRoute | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const activeGenerationRef = useRef<ActiveGeneration | null>(null)
  const mainNodeIdRef = useRef(mainNodeId)
  mainNodeIdRef.current = mainNodeId
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamSignature =
    transcript.length +
    ':' +
    (transcript[transcript.length - 1]?.answer.ai_response?.length ?? 0)
  const { scrollToBottom, showButton } = useAutoScroll(scrollRef, streamSignature)

  useEffect(() => {
    let active = true
    const cleanup = (): void => {
      active = false
      const generation = activeGenerationRef.current
      if (generation?.ownerMainNodeId !== mainNodeId) return
      activeGenerationRef.current = null
      if (generation.fallbackTimer) clearTimeout(generation.fallbackTimer)
      generation.controller.abort()
    }
    setAnnotations([])
    setNotesForMain([])
    setSegments([])
    setSelection(null)
    setMenu(null)
    setBubbleMode(null)
    setError(null)
    setTranscript([])
    setLastTurnNodeId(null)
    setPendingRoute(null)
    setRouteError(null)
    setPhase('idle')
    setBusy(false)
    if (!mainNodeId) return cleanup
    const getNode = (api as Partial<Api>).getNode
    if (!getNode) return cleanup
    void getNode(mainNodeId)
      .then((result) => {
        if (!active) return
        setAnnotations(result.annotations)
        setNotesForMain(result.annotations)
        setSegments(result.segments)
        upsertNode(result.node)
      })
      .catch(() => {
        if (active) setError('无法刷新文档详情，正在显示本地内容。')
      })
    return cleanup
  }, [api, mainNodeId, setNotesForMain, upsertNode])

  // A merge only changes the parent's 合并结论 segments (and annotations); it must
  // NOT wipe the active Q&A transcript/selection. Re-fetch segments only, and skip
  // the initial mount so the ref guard fires solely on an actual tick bump.
  const mergeTickRef = useRef(mergeRefreshTick)
  useEffect(() => {
    if (mergeTickRef.current === mergeRefreshTick) return
    mergeTickRef.current = mergeRefreshTick
    if (!mainNodeId) return
    const getNode = (api as Partial<Api>).getNode
    if (!getNode) return
    let active = true
    void getNode(mainNodeId)
      .then((result) => {
        if (!active) return
        setSegments(result.segments)
        setAnnotations(result.annotations)
        setNotesForMain(result.annotations)
      })
      .catch(() => {})
    return () => { active = false }
  }, [mergeRefreshTick, mainNodeId, api, setNotesForMain])

  useEffect(() => {
    if (!focusedAnnotationId) return
    const el = scrollRef.current?.querySelector(`[data-ann-id="${focusedAnnotationId}"]`)
    if (!el) {
      // Nothing to flash — clear so re-selecting the same note later re-triggers.
      useWorkbench.getState().setFocusedAnnotation(null)
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ann-flash')
    const t = setTimeout(() => {
      el.classList.remove('ann-flash')
      // Reset after the flash so clicking the SAME note again re-jumps.
      useWorkbench.getState().setFocusedAnnotation(null)
    }, 1200)
    return () => clearTimeout(t)
  }, [focusedAnnotationId])

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

  function patchTurn(id: string, patch: Partial<NodeRow>): void {
    setTranscript((turns) => turns.map((t) => t.id === id ? { ...t, answer: { ...t.answer, ...patch } } : t))
  }

  function beginGeneration(onCancelled: () => void = () => {}): ActiveGeneration {
    const previous = activeGenerationRef.current
    if (previous) {
      if (previous.fallbackTimer) clearTimeout(previous.fallbackTimer)
      previous.controller.abort()
    }
    const generation: ActiveGeneration = {
      controller: new AbortController(),
      fallbackTimer: null,
      onCancelled,
      ownerMainNodeId: node.id,
    }
    activeGenerationRef.current = generation
    return generation
  }

  function isCurrentGeneration(generation: ActiveGeneration): boolean {
    return activeGenerationRef.current === generation &&
      mainNodeIdRef.current === generation.ownerMainNodeId &&
      !generation.controller.signal.aborted
  }

  function setCancellationHandler(
    generation: ActiveGeneration,
    onCancelled: () => void,
  ): void {
    generation.onCancelled = onCancelled
  }

  function finishGeneration(generation: ActiveGeneration): void {
    if (activeGenerationRef.current !== generation) return
    if (generation.fallbackTimer) clearTimeout(generation.fallbackTimer)
    activeGenerationRef.current = null
  }

  function settleCancelled(generation: ActiveGeneration): void {
    if (activeGenerationRef.current !== generation) return
    if (generation.fallbackTimer) clearTimeout(generation.fallbackTimer)
    activeGenerationRef.current = null
    generation.onCancelled()
    setPhase('idle')
    setBusy(false)
  }

  async function forkExpand(question: string): Promise<void> {
    if (!selection || !treeId || busy) return
    const capturedSelection = selection
    const generation = beginGeneration()
    setBusy(true)
    setError(null)
    setPhase('thinking')
    try {
      const result = await api.fork(node.id, {
        anchorFrom: capturedSelection.from,
        anchorTo: capturedSelection.to,
        kind: 'selection',
        quotedText: capturedSelection.text,
        seedText: question,
        treeId,
      })
      generation.controller.signal.throwIfAborted()
      setAnnotations((current) => [...current, result.annotation])
      const childId = result.childNode.id
      const openSubdocTab = useWorkbench.getState().openSubdocTab
      upsertNode({ ...result.childNode, status: 'streaming', user_input: question })
      openSubdocTab(childId)
      setSelection(null)
      setBubbleMode(null)
      // Design §4③ step 4: the forked child must hold the conversation itself,
      // otherwise it is left permanently empty. Answer it with the seed question.
      let text = ''
      setCancellationHandler(generation, () => {
        upsertNode({
          ...result.childNode,
          ai_response: plainTextToProseMirror(text),
          status: 'cancelled',
          user_input: question,
        })
      })
      await api.streamAnswer(childId, question, {
        onCancelled() {
          settleCancelled(generation)
        },
        onChunk(chunk) {
          if (!isCurrentGeneration(generation)) return
          setPhase('replying')
          text += chunk
          upsertNode({ ...result.childNode, ai_response: plainTextToProseMirror(text), status: 'streaming', user_input: question })
        },
        onDone(doneNode) {
          if (!isCurrentGeneration(generation)) return
          upsertNode(doneNode)
          setPhase('idle')
        },
        onError(message) {
          if (!isCurrentGeneration(generation)) return
          upsertNode({ ...result.childNode, status: 'error', user_input: question })
          setError(`生成中断：${message}`)
          setPhase('idle')
        },
      }, generation.controller.signal)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError('分叉创建失败，请稍后重试。')
        setPhase('idle')
        throw cause
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  async function runRoutedAnswer(
    answerNodeId: string,
    optimisticParentId: string,
    question: string,
    generation: ActiveGeneration,
    handlers: AnswerStreamHandlers,
  ): Promise<void> {
    let answerDone = false
    let answerError: string | null = null
    let convergence: RouteConvergence | null = null
    const revealRoutePrompt = (): void => {
      if (
        !answerDone ||
        !convergence ||
        !isCurrentGeneration(generation)
      ) return
      if (decideRouteUi(convergence).action === 'none') {
        setPendingRoute((current) =>
          current?.answerNodeId === answerNodeId ? null : current,
        )
        return
      }
      setPendingRoute({
        answerNodeId,
        optimisticParentId,
        question,
        treeId: node.tree_id,
      })
    }

    await parallelAsk(
      { api },
      {
        answerNodeId,
        question,
        signal: generation.controller.signal,
      },
      {
        onCancelled() {
          handlers.onCancelled?.()
        },
        onChunk: handlers.onChunk,
        onDone(doneNode) {
          handlers.onDone(doneNode)
          if (!isCurrentGeneration(generation)) return
          answerDone = true
          revealRoutePrompt()
        },
        onError(message) {
          answerError = message
          handlers.onError(message)
        },
        onRoute(nextConvergence) {
          if (!isCurrentGeneration(generation)) return
          convergence = nextConvergence
          setRouteState(answerNodeId, nextConvergence)
          if (nextConvergence.state === 'failed') {
            setRouteError(humanizeRouteError(
              nextConvergence.reason ?? '未能判断回答落点',
            ))
            return
          }
          revealRoutePrompt()
        },
        onRouteError(message) {
          if (!isCurrentGeneration(generation)) return
          setRouteError(humanizeRouteError(message))
        },
      },
    )
    if (answerError) throw new Error(answerError)
  }

  async function runTurn(
    answerId: string,
    question: string,
    generation: ActiveGeneration,
    routeParentId?: string,
  ): Promise<void> {
    let text = ''
    setCancellationHandler(generation, () => {
      patchTurn(answerId, { status: 'cancelled' })
    })
    const handlers: AnswerStreamHandlers = {
      onCancelled() {
        settleCancelled(generation)
      },
      onChunk(chunk) {
        if (!isCurrentGeneration(generation)) return
        setPhase('replying')
        text += chunk
        patchTurn(answerId, { ai_response: plainTextToProseMirror(text), status: 'streaming' })
      },
      onDone(doneNode) {
        if (!isCurrentGeneration(generation)) return
        patchTurn(answerId, { ...doneNode, status: doneNode.status ?? 'complete' })
        setPhase('idle')
      },
      onError(message) {
        if (!isCurrentGeneration(generation)) return
        patchTurn(answerId, { status: 'error' })
        setError(humanize(message))
        setPhase('idle')
      },
    }
    if (routeParentId) {
      await runRoutedAnswer(
        answerId,
        routeParentId,
        question,
        generation,
        handlers,
      )
      return
    }
    await api.streamAnswer(
      answerId,
      question,
      handlers,
      generation.controller.signal,
    )
  }

  // Answer the current node itself (used for the first question on an empty node,
  // so we don't leave an empty root behind and fork a child needlessly).
  async function answerInPlace(
    targetId: string,
    question: string,
    generation: ActiveGeneration,
  ): Promise<void> {
    let currentNode = nodesById[targetId] ?? node
    let text = ''
    setCancellationHandler(generation, () => {
      upsertNode({ ...currentNode, status: 'cancelled', user_input: question })
    })
    const prepared = await api.editNode(targetId, { userInput: question })
    currentNode = {
      ...prepared.node,
      ai_response: plainTextToProseMirror(''),
      status: 'streaming',
      user_input: question,
    }
    generation.controller.signal.throwIfAborted()
    upsertNode(currentNode)
    await api.streamAnswer(targetId, question, {
      onCancelled() {
        settleCancelled(generation)
      },
      onChunk(chunk) {
        if (!isCurrentGeneration(generation)) return
        setPhase('replying')
        text += chunk
        currentNode = {
          ...prepared.node,
          ai_response: plainTextToProseMirror(text),
          status: 'streaming',
          user_input: question,
        }
        upsertNode(currentNode)
      },
      onDone(doneNode) {
        if (!isCurrentGeneration(generation)) return
        upsertNode({ ...doneNode, status: doneNode.status ?? 'complete' })
        setPhase('idle')
      },
      onError(message) {
        if (!isCurrentGeneration(generation)) return
        upsertNode({ ...currentNode, status: 'error', user_input: question })
        setError(humanize(message))
        setPhase('idle')
      },
    }, generation.controller.signal)
  }

  async function ask(question: string): Promise<void> {
    if (!treeId || busy) return
    // Linear conversation. The first question on an empty node fills that node
    // itself (no empty root left behind). Once a node already holds an answer,
    // follow-ups fork from the previous turn's answer (or the current node), so
    // the backend's ancestor-full segments carry history. Turns are local state
    // only until the user explicitly accepts a routing migration.
    const currentIsEmpty = !node.user_input && !node.ai_response
    setBusy(true)
    setError(null)
    setPendingRoute(null)
    setRouteError(null)
    setPhase('thinking')
    setLastQuestion(question)
    const generation = beginGeneration()
    try {
      if (transcript.length === 0 && lastTurnNodeId === null && currentIsEmpty) {
        setLastTurnNodeId(node.id)
        await answerInPlace(node.id, question, generation)
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
      generation.controller.signal.throwIfAborted()
      const prepared = await api.editNode(forked.childNode.id, { userInput: question })
      generation.controller.signal.throwIfAborted()
      const answerId = prepared.node.id
      setLastTurnNodeId(answerId)
      setTranscript((turns) => [...turns, {
        answer: { ...prepared.node, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: question },
        id: answerId,
        question,
      }])
      await runTurn(answerId, question, generation, parentId)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError(cause instanceof Error ? humanize(cause.message) : '提问失败，请重试。')
        setPhase('idle')
        throw cause
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  async function migrateRoute(candidate: RouteCandidate): Promise<void> {
    const current = pendingRoute
    if (!current) return
    try {
      const result = await api.migrate(current.answerNodeId, {
        newParentId: resolveMigrationParent(
          candidate,
          current.optimisticParentId,
        ),
        seedText: current.question,
        target: candidate.target,
      })
      if (useWorkbench.getState().treeId !== current.treeId) return
      for (const pathNode of result.path) upsertNode(pathNode)
      upsertNode(result.node)
      setPendingRoute((latest) =>
        latest?.answerNodeId === current.answerNodeId ? null : latest,
      )
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '迁移失败'
      setRouteError(`无法移动回答落点：${detail}。当前回答仍保留在原位置。`)
    }
  }

  async function retryLastTurn(): Promise<void> {
    if (busy || !lastQuestion) return
    if (!lastTurnNodeId) { void ask(lastQuestion); return }
    setBusy(true)
    setError(null)
    setPhase('thinking')
    const generation = beginGeneration(() => patchLastTurn({ status: 'cancelled' }))
    patchLastTurn({ status: 'streaming' })
    try {
      await runTurn(lastTurnNodeId, lastQuestion, generation)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError(cause instanceof Error ? humanize(cause.message) : '重试失败，请重试。')
        setPhase('idle')
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  function stop(): void {
    const generation = activeGenerationRef.current
    if (!generation || generation.controller.signal.aborted) return
    setPhase('cancelling')
    generation.fallbackTimer = setTimeout(() => {
      settleCancelled(generation)
    }, 2000)
    generation.controller.abort()
  }

  async function editMainQuestion(next: string): Promise<void> {
    if (busy) return
    setBusy(true); setError(null); setPhase('thinking')
    const generation = beginGeneration(() => {
      upsertNode({ ...node, status: 'cancelled', user_input: next })
    })
    try {
      await answerInPlace(node.id, next, generation)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError(cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。')
        setPhase('idle')
        throw cause
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  async function editTurnQuestion(turn: Turn, next: string): Promise<void> {
    if (busy) return
    setBusy(true); setError(null); setPhase('thinking')
    const generation = beginGeneration(() => {
      patchTurn(turn.id, { status: 'cancelled', user_input: next })
    })
    try {
      await api.editNode(turn.id, { userInput: next })
      generation.controller.signal.throwIfAborted()
      setTranscript((turns) => turns.map((t) => t.id === turn.id
        ? { ...t, question: next, answer: { ...t.answer, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: next } } : t))
      // NOTE: do NOT setLastQuestion(next) here. runTurn(turn.id, next) uses `next`
      // directly for the edit; lastQuestion must stay coupled to the actual last turn
      // (set by ask), or retryLastTurn would regenerate the last turn with a non-last
      // edited question. See final-review FIX 1.
      await runTurn(turn.id, next, generation)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError(cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。')
        setPhase('idle')
        throw cause
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  async function retryCurrent(): Promise<void> {
    const question = node.user_input?.trim()
    if (!question || busy) return
    let text = ''
    let currentNode = node
    setBusy(true)
    setError(null)
    setPhase('thinking')
    const generation = beginGeneration(() => {
      upsertNode({ ...currentNode, status: 'cancelled' })
    })
    upsertNode({ ...node, status: 'streaming' })
    try {
      await api.streamAnswer(node.id, question, {
        onCancelled() {
          settleCancelled(generation)
        },
        onChunk(chunk) {
          if (!isCurrentGeneration(generation)) return
          setPhase('replying')
          text += chunk
          currentNode = {
            ...node,
            ai_response: plainTextToProseMirror(text),
            status: 'streaming',
          }
          upsertNode(currentNode)
        },
        onDone(doneNode) {
          if (!isCurrentGeneration(generation)) return
          upsertNode(doneNode)
          setPhase('idle')
        },
        onError(message) {
          if (!isCurrentGeneration(generation)) return
          upsertNode({ ...currentNode, status: 'error' })
          setError(humanize(message))
          setPhase('idle')
        },
      }, generation.controller.signal)
    } catch (cause) {
      if (isAbortError(cause, generation.controller.signal)) {
        settleCancelled(generation)
      } else {
        setError('重试失败，请检查 Provider 设置。')
        setPhase('idle')
      }
    } finally {
      finishGeneration(generation)
      setBusy(false)
    }
  }

  return (
    <div className="main-doc-content">
      <div className="main-doc-scroll" data-testid="conversation-scroll" ref={scrollRef}>
        <section aria-label="主对话轮次" className="turn-card">
          <div className="turn-badge"><span className="turn-badge-dot" />第 1 轮</div>
          {node.user_input && (
            <QuestionEditor question={node.user_input} disabled={busy} onResubmit={(next) => { return editMainQuestion(next) }} />
          )}
          <DocView annotations={annotations} node={node} onAnchorClick={(annId) => {
            const target = pickAnchorTarget(annotations, annId, (childId) => {
              const n = nodesById[childId]
              return !!n && n.is_deleted === 0
            })
            const s = useWorkbench.getState()
            if (!target) return
            if (target.kind === 'branch') { s.setSubdocPanelTab('derivations'); s.openSubdocTab(target.childNodeId) }
            else { s.setSubdocPanelTab('notes'); s.setAnchoredNoteId(target.annotationId) }
          }} onContextSelect={(sel, x, y) => { setSelection(sel); setMenu({ x, y }) }} onRetry={() => { void retryCurrent() }} onSelect={setSelection} />
          <MergedConclusions segments={segments} />
        </section>
        {transcript.map((turn, index) => (
          <section aria-label="对话轮次" className="turn-card" key={turn.id}>
            <div className="turn-badge"><span className="turn-badge-dot" />第 {index + 2} 轮</div>
            <QuestionEditor
              disabled={busy}
              onResubmit={(next) => { return editTurnQuestion(turn, next) }}
              question={turn.question}
              testId="turn-question"
            />
            <DocView
              annotations={[]}
              errorText={index === transcript.length - 1 && error ? error : undefined}
              node={turn.answer}
              onRetry={() => { void retryLastTurn() }}
              onSelect={() => {}}
            />
          </section>
        ))}
        {pendingRoute && routeByNodeId[pendingRoute.answerNodeId] && (
          <RoutePrompt
            decision={decideRouteUi(routeByNodeId[pendingRoute.answerNodeId])}
            onAccept={(candidate) => { void migrateRoute(candidate) }}
            onDismiss={() => setPendingRoute(null)}
            onPick={(candidate) => { void migrateRoute(candidate) }}
          />
        )}
        {routeError && (
          <RouteErrorNotice
            message={routeError}
            onDismiss={() => setRouteError(null)}
          />
        )}
        {menu && selection && (
          <SelectionMenu
            onClose={() => setMenu(null)}
            onPick={(kind) => { setBubbleMode(kind); setMenu(null) }}
            x={menu.x}
            y={menu.y}
          />
        )}
        {selection && bubbleMode && (
          <AnnotationBubble
            initialFocus={bubbleMode}
            onCreateNote={(noteText) => {
              if (!selection) { setSelection(null); setBubbleMode(null); return }
              const targetNodeId = node.id
              void api.createNote(targetNodeId, {
                anchorFrom: selection.from, anchorTo: selection.to,
                quotedText: selection.text, note: noteText,
              }).then((res) => {
                // Local annotations always get the new mark (drives the highlight).
                setAnnotations((cur) => [...cur, res.annotation])
                // Only append to the global list if the main node hasn't switched,
                // and dedupe by id so a concurrent merge-refetch can't dup the key.
                const cur = useWorkbench.getState().notesForMain
                if (useWorkbench.getState().mainNodeId === targetNodeId && !cur.some((a) => a.id === res.annotation.id)) {
                  useWorkbench.getState().setNotesForMain([...cur, res.annotation])
                }
              }).catch(() => setError('笔记保存失败，请重试。'))
              setSelection(null)
              setBubbleMode(null)
            }}
            onDismiss={() => { setSelection(null); setBubbleMode(null) }}
            onForkExpand={(question) => { return forkExpand(question) }}
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
        <ChatBox disabled={busy} onSubmit={(question) => { return ask(question) }} />
      </div>
    </div>
  )
}
