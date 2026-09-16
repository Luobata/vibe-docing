import {
  documentContentOf,
  plainTextToProseMirror,
  type AnnotationRow,
  type ContextSegmentRow,
  type NodeRow,
  type VisualAnnotationTarget,
} from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import type { AnswerStreamHandlers, Api } from '../api/client'
import { useApi } from '../api/context'
import type { RouteCandidate, RouteConvergence } from '../api/types'
import { pickAnchorTarget } from '../doc/anchor-target'
import type { PlainSelection } from '../doc/selection'
import { decideRouteUi, resolveMigrationParent } from '../flow/answer-flow'
import { parallelAsk } from '../flow/parallel-ask'
import { transitionDocument } from '../flow/document-transition'
import { useAutoScroll } from '../flow/use-auto-scroll'
import {
  generationTaskKeys,
  generationTaskRegistry,
  useGenerationTasks,
  useWorkbench,
  type GenerationTask,
  type GenerationTaskKind,
} from '../state/workbench-store'
import { AnnotationBubble } from './AnnotationBubble'
import { AssistantStatus } from './AssistantStatus'
import { ChatBox } from './ChatBox'
import { CorrectiveMergeButton } from './CorrectiveMergeButton'
import { DocView } from './DocView'
import { DiscussionStrip } from './DiscussionStrip'
import { SynthesisPanel } from './SynthesisPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { Icon } from './Icon'
import { DocumentEditor, type DocumentEditorHandle } from '../editor/DocumentEditor'
import { MergedConclusions } from './MergedConclusions'
import { QuestionEditor } from './QuestionEditor'
import { RouteErrorNotice, RoutePrompt } from './RoutePrompt'
import { SelectionMenu } from './SelectionMenu'
import { isSelectionSource } from './subdoc-classification'

interface Turn {
  answer: NodeRow
  id: string
  question: string
}

interface PendingRoute {
  answerNodeId: string
  optimisticParentId: string
  question: string
  treeId: string
}

interface ParentContext {
  annotation: AnnotationRow | null
  node: NodeRow
  sourceText: string | null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

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

function currentTask(task: GenerationTask): GenerationTask | undefined {
  const current = generationTaskRegistry.getSnapshot().byKey[task.key]
  return current?.runId === task.runId ? current : undefined
}

function generatedContent(text: string): Pick<NodeRow, 'ai_response' | 'document_content'> {
  const content = plainTextToProseMirror(text)
  return { ai_response: content, document_content: content }
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
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const [segments, setSegments] = useState<ContextSegmentRow[]>([])
  const [selection, setSelection] = useState<PlainSelection | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [bubbleMode, setBubbleMode] = useState<'note' | 'expand' | null>(null)
  const [visualTarget, setVisualTarget] = useState<VisualAnnotationTarget | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [lastTurnNodeId, setLastTurnNodeId] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  const [pendingRoute, setPendingRoute] = useState<PendingRoute | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [parentContext, setParentContext] = useState<ParentContext | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const documentEditorRef = useRef<DocumentEditorHandle>(null)
  const latestAnswer = transcript.length > 0
    ? (nodesById[transcript[transcript.length - 1].id] ?? transcript[transcript.length - 1].answer)
    : null
  const streamSignature = transcript.length + ':' + (latestAnswer ? documentContentOf(latestAnswer)?.length ?? 0 : 0)
  const { scrollToBottom, showButton } = useAutoScroll(scrollRef, streamSignature)

  useEffect(() => {
    let active = true
    const cleanup = (): void => {
      active = false
    }
    setAnnotations([])
    setNotesForMain([])
    setSegments([])
    setSelection(null)
    setVisualTarget(null)
    setMenu(null)
    setBubbleMode(null)
    setViewError(null)
    setTranscript([])
    setLastTurnNodeId(null)
    setLastQuestion('')
    setPendingRoute(null)
    setRouteError(null)
    setParentContext(null)
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
        if (result.node.parent_id) {
          const sourceText = result.segments.find((segment) =>
            segment.type === 'annotation-seed' && segment.content?.trim(),
          )?.content?.trim() ?? null
          void getNode(result.node.parent_id)
            .then((parent) => {
              if (!active) return
              setParentContext({
                annotation: parent.annotations.find((item) => item.child_node_id === result.node.id) ?? null,
                node: parent.node,
                sourceText,
              })
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        if (active) setViewError('无法刷新文档详情，正在显示本地内容。')
      })
    return cleanup
  }, [api, mainNodeId, setNotesForMain, upsertNode])

  // A merge only changes the parent's 合并结论 segments (and annotations); it must
  // not wipe the active Q&A transcript/selection.
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
    if (!el) return
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
    el.classList.add('ann-flash')
    const timer = setTimeout(() => {
      el.classList.remove('ann-flash')
      useWorkbench.getState().setFocusedAnnotation(null)
    }, 10_000)
    return () => clearTimeout(timer)
  }, [annotations, focusedAnnotationId])

  if (!mainNodeId) return <div className="document-placeholder" data-testid="main-doc-empty">← 先在左上角输入名称并新建笔记库，选中笔记后即可直接写作，或在下方对话让 AI 生成内容</div>
  const node = nodesById[mainNodeId]
  if (!node) return <div className="inline-error" role="alert">当前文档不存在</div>

  const nodeTaskKey = taskKeyByTarget[node.id]
  const nodeTask = nodeTaskKey ? tasksByKey[nodeTaskKey] : undefined
  const askTask = tasksByKey[generationTaskKeys.ask(node.id)]
  const mainLineTasks = Object.values(tasksByKey).filter((task) =>
    task.ownerMainNodeId === node.id &&
    task.status === 'streaming' &&
    task.kind !== 'fork-expand',
  )
  const selectionTaskKey = selection
    ? generationTaskKeys.forkExpand(node.id, selection.from, selection.to)
    : null

  function isOwnerVisible(task: GenerationTask): boolean {
    return useWorkbench.getState().mainNodeId === task.ownerMainNodeId
  }

  function patchTurn(id: string, patch: Partial<NodeRow>): void {
    setTranscript((turns) => turns.map((turn) =>
      turn.id === id
        ? { ...turn, answer: { ...turn.answer, ...patch } }
        : turn,
    ))
  }

  function updateTaskNode(
    task: GenerationTask,
    targetNodeId: string,
    nextNode: NodeRow,
    options?: { localTurn?: boolean; refreshSubdocTabs?: boolean },
  ): boolean {
    const current = currentTask(task)
    if (
      !generationTaskRegistry.isTaskLive(task) ||
      current?.targetNodeId !== targetNodeId ||
      nextNode.id !== targetNodeId
    ) return false
    useWorkbench.getState().upsertNode(nextNode, {
      refreshSubdocTabs: options?.refreshSubdocTabs,
    })
    if (options?.localTurn && isOwnerVisible(task)) patchTurn(targetNodeId, nextNode)
    return true
  }

  function startTask(input: {
    key: string
    kind: GenerationTaskKind
    onCancelled(): void
    targetNodeId?: string | null
  }): GenerationTask | null {
    return generationTaskRegistry.start({
      ...input,
      ownerMainNodeId: node.id,
    })
  }

  function settleCancelled(task: GenerationTask): void {
    generationTaskRegistry.settle(task, 'cancelled')
  }

  async function flushDocument(): Promise<void> {
    await documentEditorRef.current?.flush()
  }

  async function forkExpand(question: string): Promise<void> {
    await flushDocument()
    if (!selection || !treeId) return
    const capturedSelection = selection
    const key = generationTaskKeys.forkExpand(
      node.id,
      capturedSelection.from,
      capturedSelection.to,
    )
    let childNode: NodeRow | null = null
    let text = ''
    const task = startTask({
      key,
      kind: 'fork-expand',
      onCancelled() {
        if (!childNode) return
        useWorkbench.getState().upsertNode({
          ...childNode,
          ...generatedContent(text),
          status: 'cancelled',
          user_input: question,
        })
      },
    })
    if (!task) throw new Error('该选区的展开正在进行中')

    let created = false
    try {
      const result = await api.fork(node.id, {
        anchorFrom: capturedSelection.from,
        anchorTo: capturedSelection.to,
        kind: 'selection',
        quotedText: capturedSelection.text,
        seedText: question,
        treeId,
      }, task.controller.signal)
      task.controller.signal.throwIfAborted()
      childNode = result.childNode
      if (!generationTaskRegistry.setTarget(task, childNode.id)) {
        throw new Error('目标分支已有生成任务')
      }
      const streamingNode: NodeRow = {
        ...childNode,
        ...generatedContent(''),
        status: 'streaming',
        user_input: question,
      }
      if (!updateTaskNode(task, childNode.id, streamingNode)) return
      created = true
      if (isOwnerVisible(task)) {
        setAnnotations((current) => [...current, result.annotation])
        const workbench = useWorkbench.getState()
        if (!workbench.notesForMain.some((item) => item.id === result.annotation.id)) {
          workbench.setNotesForMain([...workbench.notesForMain, result.annotation])
        }
        workbench.openSubdocTab(childNode.id)
        workbench.setSubdocPanelTab('derivations')
        setSelection(null)
        setMenu(null)
        setBubbleMode(null)
      }

      await api.streamAnswer(childNode.id, question, {
        onCancelled() {
          settleCancelled(task)
        },
        onChunk(chunk) {
          if (!generationTaskRegistry.isTaskLive(task) || !childNode) return
          generationTaskRegistry.patchPhase(task, 'replying')
          text += chunk
          updateTaskNode(task, childNode.id, {
            ...childNode,
            ...generatedContent(text),
            status: 'streaming',
            user_input: question,
          })
        },
        onDone(doneNode) {
          if (!childNode || !updateTaskNode(task, childNode.id, doneNode)) return
          generationTaskRegistry.settle(task, 'complete')
        },
        onError(message) {
          if (!childNode || !generationTaskRegistry.isTaskLive(task)) return
          const readable = humanize(message)
          updateTaskNode(task, childNode.id, {
            ...childNode,
            ...generatedContent(text),
            status: 'error',
            user_input: question,
          })
          generationTaskRegistry.settle(task, 'error', readable)
        },
      }, task.controller.signal)
      if (generationTaskRegistry.isTaskLive(task) && childNode) {
        const readable = 'AI 未返回完成状态，当前关联内容已保留，可单独重试。'
        updateTaskNode(task, childNode.id, {
          ...childNode,
          ...generatedContent(text),
          status: 'error',
          user_input: question,
        })
        generationTaskRegistry.settle(task, 'error', readable)
      }
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) {
        settleCancelled(task)
        return
      }
      if (generationTaskRegistry.isTaskLive(task)) {
        const readable = created
          ? humanize(cause instanceof Error ? cause.message : 'answer failed')
          : '分叉创建失败，请稍后重试。'
        if (childNode) {
          updateTaskNode(task, childNode.id, {
            ...childNode,
            ...generatedContent(text),
            status: 'error',
            user_input: question,
          })
        }
        generationTaskRegistry.settle(task, 'error', readable)
      }
      if (!created) throw cause
    }
  }

  async function runRoutedAnswer(
    answerNodeId: string,
    optimisticParentId: string,
    question: string,
    task: GenerationTask,
    handlers: AnswerStreamHandlers,
  ): Promise<void> {
    let answerDone = false
    let answerError: string | null = null
    let convergence: RouteConvergence | null = null
    const revealRoutePrompt = (): void => {
      const latest = currentTask(task)
      if (
        !answerDone ||
        !convergence ||
        latest?.status !== 'complete' ||
        !isOwnerVisible(task)
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
        signal: task.controller.signal,
      },
      {
        onCancelled: handlers.onCancelled,
        onChunk: handlers.onChunk,
        onDone(doneNode) {
          answerDone = true
          handlers.onDone(doneNode)
          revealRoutePrompt()
        },
        onError(message) {
          answerError = message
          handlers.onError(message)
        },
        onRoute(nextConvergence) {
          const latest = currentTask(task)
          if (!latest || latest.status === 'cancelled' || latest.status === 'error') return
          convergence = nextConvergence
          setRouteState(answerNodeId, nextConvergence)
          if (!isOwnerVisible(task)) return
          if (nextConvergence.state === 'failed') {
            setRouteError(humanizeRouteError(
              nextConvergence.reason ?? '未能判断回答落点',
            ))
            return
          }
          revealRoutePrompt()
        },
        onRouteError(message) {
          const latest = currentTask(task)
          if (!latest || latest.status === 'cancelled' || latest.status === 'error' || !isOwnerVisible(task)) return
          setRouteError(humanizeRouteError(message))
        },
      },
    )
    if (answerError) throw new Error(answerError)
  }

  async function runTurn(
    answerId: string,
    question: string,
    task: GenerationTask,
    baseNode: NodeRow,
    routeParentId?: string,
  ): Promise<void> {
    let text = ''
    let currentNode = baseNode
    const handlers: AnswerStreamHandlers = {
      onCancelled() {
        settleCancelled(task)
      },
      onChunk(chunk) {
        if (!generationTaskRegistry.isTaskLive(task)) return
        generationTaskRegistry.patchPhase(task, 'replying')
        text += chunk
        currentNode = {
          ...baseNode,
          ...generatedContent(text),
          status: 'streaming',
          user_input: question,
        }
        updateTaskNode(task, answerId, currentNode, {
          localTurn: true,
          refreshSubdocTabs: false,
        })
      },
      onDone(doneNode) {
        const nextNode = { ...doneNode, status: doneNode.status ?? 'complete' }
        if (!updateTaskNode(task, answerId, nextNode, {
          localTurn: true,
          refreshSubdocTabs: false,
        })) return
        generationTaskRegistry.settle(task, 'complete')
      },
      onError(message) {
        if (!generationTaskRegistry.isTaskLive(task)) return
        const readable = humanize(message)
        const failedNode = { ...currentNode, status: 'error' as const }
        updateTaskNode(task, answerId, failedNode, {
          localTurn: true,
          refreshSubdocTabs: false,
        })
        generationTaskRegistry.settle(task, 'error', readable)
      },
    }
    if (routeParentId) {
      await runRoutedAnswer(answerId, routeParentId, question, task, handlers)
    } else {
      await api.streamAnswer(answerId, question, handlers, task.controller.signal)
    }
    if (generationTaskRegistry.isTaskLive(task)) {
      const readable = '模型未返回完成状态，请重试。'
      updateTaskNode(task, answerId, { ...currentNode, status: 'error' }, {
        localTurn: true,
        refreshSubdocTabs: false,
      })
      generationTaskRegistry.settle(task, 'error', readable)
      throw new Error(readable)
    }
  }

  async function answerInPlace(
    targetId: string,
    question: string,
    task: GenerationTask,
  ): Promise<void> {
    let currentNode = useWorkbench.getState().nodesById[targetId] ?? node
    let text = ''
    const prepared = await api.editNode(targetId, { userInput: question })
    task.controller.signal.throwIfAborted()
    currentNode = {
      ...prepared.node,
      ...generatedContent(''),
      status: 'streaming',
      user_input: question,
    }
    updateTaskNode(task, targetId, currentNode)
    await api.streamAnswer(targetId, question, {
      onCancelled() {
        settleCancelled(task)
      },
      onChunk(chunk) {
        if (!generationTaskRegistry.isTaskLive(task)) return
        generationTaskRegistry.patchPhase(task, 'replying')
        text += chunk
        currentNode = {
          ...prepared.node,
          ...generatedContent(text),
          status: 'streaming',
          user_input: question,
        }
        updateTaskNode(task, targetId, currentNode)
      },
      onDone(doneNode) {
        if (!updateTaskNode(task, targetId, {
          ...doneNode,
          status: doneNode.status ?? 'complete',
        })) return
        generationTaskRegistry.settle(task, 'complete')
      },
      onError(message) {
        if (!generationTaskRegistry.isTaskLive(task)) return
        const readable = humanize(message)
        updateTaskNode(task, targetId, {
          ...currentNode,
          status: 'error',
          user_input: question,
        })
        generationTaskRegistry.settle(task, 'error', readable)
      },
    }, task.controller.signal)
    if (generationTaskRegistry.isTaskLive(task)) {
      const readable = '模型未返回完成状态，请重试。'
      updateTaskNode(task, targetId, { ...currentNode, status: 'error' })
      generationTaskRegistry.settle(task, 'error', readable)
      throw new Error(readable)
    }
  }

  async function ask(question: string): Promise<void> {
    await flushDocument()
    if (!treeId) return
    const currentIsEmpty = !node.user_input && !documentContentOf(node)
    let cancelledNode: NodeRow | null = currentIsEmpty ? node : null
    let cancelledTurnId: string | null = null
    const task = startTask({
      key: generationTaskKeys.ask(node.id),
      kind: 'ask',
      onCancelled() {
        if (!cancelledNode) return
        const targetId = cancelledTurnId ?? (currentIsEmpty ? node.id : null)
        const latestNode = targetId
          ? useWorkbench.getState().nodesById[targetId]
          : undefined
        const nextNode = { ...(latestNode ?? cancelledNode), status: 'cancelled' as const }
        useWorkbench.getState().upsertNode(nextNode, {
          refreshSubdocTabs: cancelledTurnId ? false : undefined,
        })
        if (cancelledTurnId && isOwnerVisible(task!)) patchTurn(cancelledTurnId, nextNode)
      },
      targetNodeId: currentIsEmpty ? node.id : null,
    })
    if (!task) throw new Error('该主线动作正在进行中')
    if (isOwnerVisible(task)) {
      setPendingRoute(null)
      setRouteError(null)
      setLastQuestion(question)
    }
    try {
      if (transcript.length === 0 && lastTurnNodeId === null && currentIsEmpty) {
        if (isOwnerVisible(task)) setLastTurnNodeId(node.id)
        await answerInPlace(node.id, question, task)
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
      }, task.controller.signal)
      task.controller.signal.throwIfAborted()
      const prepared = await api.editNode(forked.childNode.id, { userInput: question })
      task.controller.signal.throwIfAborted()
      const answerId = prepared.node.id
      if (!generationTaskRegistry.setTarget(task, answerId)) throw new Error('目标节点已有生成任务')
      const streamingNode: NodeRow = {
        ...prepared.node,
        ...generatedContent(''),
        status: 'streaming',
        user_input: question,
      }
      cancelledNode = streamingNode
      cancelledTurnId = answerId
      const isDirectGlobalDerivation = parentId === node.id
      useWorkbench.getState().upsertNode(streamingNode, {
        refreshSubdocTabs: isDirectGlobalDerivation,
      })
      if (isOwnerVisible(task)) {
        if (isDirectGlobalDerivation) {
          setAnnotations((current) => current.some((item) => item.id === forked.annotation.id)
            ? current
            : [...current, forked.annotation])
          const workbench = useWorkbench.getState()
          if (!workbench.notesForMain.some((item) => item.id === forked.annotation.id)) {
            workbench.setNotesForMain([...workbench.notesForMain, forked.annotation])
          }
          workbench.openSubdocTab(answerId)
          workbench.setSubdocPanelTab('global')
        }
        setLastTurnNodeId(answerId)
        setTranscript((turns) => [...turns, {
          answer: streamingNode,
          id: answerId,
          question,
        }])
      }
      await runTurn(answerId, question, task, streamingNode, parentId)
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) {
        settleCancelled(task)
      } else {
        if (generationTaskRegistry.isTaskLive(task)) {
          generationTaskRegistry.settle(
            task,
            'error',
            cause instanceof Error ? humanize(cause.message) : '提问失败，请重试。',
          )
        }
        throw cause
      }
    }
  }

  async function migrateRoute(candidate: RouteCandidate): Promise<void> {
    const current = pendingRoute
    if (!current) return
    try {
      const result = await api.migrate(current.answerNodeId, {
        newParentId: resolveMigrationParent(candidate, current.optimisticParentId),
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
    if (!lastQuestion) return
    if (!lastTurnNodeId) {
      await ask(lastQuestion)
      return
    }
    const targetId = lastTurnNodeId
    let currentNode = useWorkbench.getState().nodesById[targetId] ?? transcript.find((turn) => turn.id === targetId)?.answer
    if (!currentNode) return
    const task = startTask({
      key: generationTaskKeys.retry(targetId),
      kind: 'retry',
      onCancelled() {
        currentNode = {
          ...(useWorkbench.getState().nodesById[targetId] ?? currentNode!),
          status: 'cancelled',
        }
        useWorkbench.getState().upsertNode(currentNode, { refreshSubdocTabs: false })
        if (isOwnerVisible(task!)) patchTurn(targetId, currentNode)
      },
      targetNodeId: targetId,
    })
    if (!task) return
    currentNode = { ...currentNode, status: 'streaming' }
    useWorkbench.getState().upsertNode(currentNode, { refreshSubdocTabs: false })
    if (isOwnerVisible(task)) patchTurn(targetId, currentNode)
    try {
      await runTurn(targetId, lastQuestion, task, currentNode)
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) settleCancelled(task)
      else if (generationTaskRegistry.isTaskLive(task)) {
        generationTaskRegistry.settle(task, 'error', cause instanceof Error ? humanize(cause.message) : '重试失败，请重试。')
      }
    }
  }

  async function editMainQuestion(next: string): Promise<void> {
    await flushDocument()
    let currentNode = node
    const task = startTask({
      key: generationTaskKeys.edit(node.id),
      kind: 'edit',
      onCancelled() {
        currentNode = {
          ...(useWorkbench.getState().nodesById[node.id] ?? currentNode),
          status: 'cancelled',
        }
        useWorkbench.getState().upsertNode(currentNode)
      },
      targetNodeId: node.id,
    })
    if (!task) throw new Error('该节点已有生成任务')
    try {
      await answerInPlace(node.id, next, task)
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) settleCancelled(task)
      else {
        if (generationTaskRegistry.isTaskLive(task)) {
          const readable = cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。'
          useWorkbench.getState().upsertNode({ ...currentNode, status: 'error' })
          generationTaskRegistry.settle(task, 'error', readable)
        }
        throw cause
      }
    }
  }

  async function editTurnQuestion(turn: Turn, next: string): Promise<void> {
    let currentNode = useWorkbench.getState().nodesById[turn.id] ?? turn.answer
    const task = startTask({
      key: generationTaskKeys.edit(turn.id),
      kind: 'edit',
      onCancelled() {
        currentNode = {
          ...(useWorkbench.getState().nodesById[turn.id] ?? currentNode),
          status: 'cancelled',
        }
        useWorkbench.getState().upsertNode(currentNode, { refreshSubdocTabs: false })
        if (isOwnerVisible(task!)) patchTurn(turn.id, currentNode)
      },
      targetNodeId: turn.id,
    })
    if (!task) throw new Error('该节点已有生成任务')
    try {
      const prepared = await api.editNode(turn.id, { userInput: next })
      task.controller.signal.throwIfAborted()
      currentNode = {
        ...prepared.node,
        ...generatedContent(''),
        status: 'streaming',
        user_input: next,
      }
      useWorkbench.getState().upsertNode(currentNode, { refreshSubdocTabs: false })
      if (isOwnerVisible(task)) {
        setTranscript((turns) => turns.map((item) => item.id === turn.id
          ? { ...item, answer: currentNode, question: next }
          : item))
      }
      await runTurn(turn.id, next, task, currentNode)
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) settleCancelled(task)
      else {
        if (generationTaskRegistry.isTaskLive(task)) {
          const readable = cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。'
          useWorkbench.getState().upsertNode({ ...currentNode, status: 'error' }, { refreshSubdocTabs: false })
          if (isOwnerVisible(task)) patchTurn(turn.id, { status: 'error' })
          generationTaskRegistry.settle(task, 'error', readable)
        }
        throw cause
      }
    }
  }

  async function retryCurrent(): Promise<void> {
    await flushDocument()
    const question = node.user_input?.trim()
    if (!question) return
    let currentNode = node
    let text = ''
    const task = startTask({
      key: generationTaskKeys.retry(node.id),
      kind: 'retry',
      onCancelled() {
        useWorkbench.getState().upsertNode({ ...currentNode, status: 'cancelled' })
      },
      targetNodeId: node.id,
    })
    if (!task) return
    currentNode = { ...node, status: 'streaming' }
    upsertNode(currentNode)
    try {
      await api.streamAnswer(node.id, question, {
        onCancelled() {
          settleCancelled(task)
        },
        onChunk(chunk) {
          if (!generationTaskRegistry.isTaskLive(task)) return
          generationTaskRegistry.patchPhase(task, 'replying')
          text += chunk
          currentNode = {
            ...node,
            ...generatedContent(text),
            status: 'streaming',
          }
          updateTaskNode(task, node.id, currentNode)
        },
        onDone(doneNode) {
          if (!updateTaskNode(task, node.id, doneNode)) return
          generationTaskRegistry.settle(task, 'complete')
        },
        onError(message) {
          if (!generationTaskRegistry.isTaskLive(task)) return
          const readable = humanize(message)
          updateTaskNode(task, node.id, { ...currentNode, status: 'error' })
          generationTaskRegistry.settle(task, 'error', readable)
        },
      }, task.controller.signal)
      if (generationTaskRegistry.isTaskLive(task)) {
        const readable = '模型未返回完成状态，请重试。'
        updateTaskNode(task, node.id, { ...currentNode, status: 'error' })
        generationTaskRegistry.settle(task, 'error', readable)
      }
    } catch (cause) {
      if (isAbortError(cause, task.controller.signal)) settleCancelled(task)
      else if (generationTaskRegistry.isTaskLive(task)) {
        const readable = '重试失败，请检查高级设置中的 AI 服务商。'
        updateTaskNode(task, node.id, { ...currentNode, status: 'error' })
        generationTaskRegistry.settle(task, 'error', readable)
      }
    }
  }

  return (
    <div className="main-doc-content">
      <div className="main-doc-scroll" data-testid="conversation-scroll" ref={scrollRef}>
        {parentContext && (
          <aside className="parent-context" aria-label="关联来源">
            <div className="parent-context-label">基于</div>
            <div className="parent-context-copy">
              <strong>{parentContext.node.user_input?.split('\n')[0]?.trim() || '父文档'}</strong>
              <span>{parentContext.annotation?.quoted_text || parentContext.sourceText || '基于来源笔记的上下文展开'}</span>
            </div>
            <CorrectiveMergeButton
              compact
              sourceNodeId={node.id}
              targetNodeId={parentContext.node.id}
            />
            <button
              className="quiet-button"
              onClick={() => {
                transitionDocument(() => {
                  const store = useWorkbench.getState()
                  const source = parentContext.annotation
                  const anchoredToSelection = isSelectionSource(source ?? undefined)
                  store.setMain(parentContext.node.id)
                  store.setSubdocPanelTab(anchoredToSelection ? 'derivations' : 'global')
                  store.setActiveSubdoc(node.id)
                  if (anchoredToSelection && source) {
                    store.setAnchoredSubdocId(node.id)
                    store.setFocusedAnnotation(source.id)
                  }
                })
              }}
              type="button"
            >
              返回来源
            </button>
          </aside>
        )}
        <section aria-label="文档正文" className="document-sheet">
          {node.user_input && (
            <details className="document-source">
              <summary>生成来源</summary>
              <QuestionEditor
                disabled={Boolean(nodeTask && nodeTask.status === 'streaming')}
                onResubmit={editMainQuestion}
                question={node.user_input}
              />
            </details>
          )}
          <DocumentEditor
            annotations={annotations}
            disabled={Boolean(nodeTask && nodeTask.status === 'streaming')}
            errorText={nodeTask?.error ?? undefined}
            node={node}
            onAnchorClick={(annId) => {
              const target = pickAnchorTarget(annotations, annId, (childId) => {
                const candidate = nodesById[childId]
                return !!candidate && candidate.is_deleted === 0
              })
              const workbench = useWorkbench.getState()
              if (!target) return
              if (target.kind === 'branch') {
                workbench.setSubdocPanelTab('derivations')
                workbench.openSubdocTab(target.childNodeId)
              } else {
                workbench.setSubdocPanelTab('notes')
                workbench.setAnchoredNoteId(target.annotationId)
              }
            }}
            onContextSelect={(nextSelection, x, y) => {
              setVisualTarget(null)
              setSelection(nextSelection)
              setMenu({ x, y })
            }}
            onRetry={() => { void retryCurrent() }}
            onSaved={(savedNode) => {
              useWorkbench.getState().upsertNode(savedNode)
            }}
            onSelect={(nextSelection) => {
              setVisualTarget(null)
              setSelection(nextSelection)
            }}
            onVisualAnnotate={(reference, from, to) => {
              setVisualTarget({ artifactId: reference.artifactId, revision: reference.revision, target: 'whole' })
              setSelection({ from, to, text: reference.altText })
              setMenu(null)
              setBubbleMode('note')
            }}
            ref={documentEditorRef}
          />
          <MergedConclusions segments={segments} />
        </section>
        <DiscussionStrip key={node.id} node={node} onSaved={upsertNode} />
        <SynthesisPanel key={`synthesis-${node.tree_id}`} node={node} />
        <MaterialsPanel key={`materials-${node.tree_id}`} treeId={node.tree_id} />
        {transcript.map((turn, index) => {
          const turnNode = nodesById[turn.id] ?? turn.answer
          const turnTaskKey = taskKeyByTarget[turn.id]
          const turnTask = turnTaskKey ? tasksByKey[turnTaskKey] : undefined
          return (
            <section aria-label="对话轮次" className="turn-card" key={turn.id}>
              <div className="turn-badge"><span className="turn-badge-dot" />第 {index + 2} 轮</div>
              <QuestionEditor
                disabled={Boolean(turnTask && turnTask.status === 'streaming')}
                onResubmit={(next) => editTurnQuestion(turn, next)}
                question={turn.question}
                testId="turn-question"
              />
              <DocView
                annotations={[]}
                errorText={turnTask?.error ?? undefined}
                generationTaskKey={turnTask?.key}
                node={turnNode}
                onRetry={() => { void retryLastTurn() }}
                onSelect={() => {}}
                retryDisabled={Boolean(turnTask && turnTask.status === 'streaming')}
                retryTaskKey={generationTaskKeys.retry(turn.id)}
              />
            </section>
          )
        })}
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
        {menu && selection && selectionTaskKey && (
          <SelectionMenu
            onClose={() => setMenu(null)}
            onPick={(kind) => { setBubbleMode(kind); setMenu(null) }}
            taskKey={selectionTaskKey}
            x={menu.x}
            y={menu.y}
          />
        )}
        {selection && bubbleMode && selectionTaskKey && (
          <AnnotationBubble
            initialFocus={bubbleMode}
            onCreateNote={(noteText) => {
              const targetNodeId = node.id
              void api.createNote(targetNodeId, {
                anchorFrom: visualTarget ? null : selection.from,
                anchorTo: visualTarget ? null : selection.to,
                quotedText: visualTarget ? null : selection.text,
                note: noteText,
                ...(visualTarget ? { visualTarget } : {}),
              }).then((result) => {
                if (useWorkbench.getState().mainNodeId === targetNodeId) {
                  setAnnotations((current) => [...current, result.annotation])
                }
                const current = useWorkbench.getState().notesForMain
                if (
                  useWorkbench.getState().mainNodeId === targetNodeId &&
                  !current.some((annotation) => annotation.id === result.annotation.id)
                ) {
                  useWorkbench.getState().setNotesForMain([...current, result.annotation])
                }
              }).catch(() => setViewError('笔记保存失败，请重试。'))
              setSelection(null)
              setVisualTarget(null)
              setBubbleMode(null)
            }}
            onDismiss={() => { setSelection(null); setVisualTarget(null); setBubbleMode(null) }}
            onForkExpand={forkExpand}
            selection={selection}
            taskKey={selectionTaskKey}
          />
        )}
        {viewError && <p className="inline-error" role="alert">{viewError}</p>}
      </div>
      {showButton && (
        <button className="scroll-to-bottom" data-testid="scroll-to-bottom" onClick={scrollToBottom} type="button">
          <Icon name="chevron-down" size={12} /> 回到底部
        </button>
      )}
      <div className="composer">
        <div className="composer-title">
          <strong>AI 辅助</strong>
          <span>基于当前笔记继续提问，正文仍由你决定</span>
        </div>
        {mainLineTasks.map((task) => (
          <AssistantStatus
            key={`${task.key}:${task.runId}`}
            onStop={(key) => { generationTaskRegistry.stop(key) }}
            phase={task.phase}
            taskKey={task.key}
          />
        ))}
        <ChatBox
          disabled={Boolean(askTask && askTask.status === 'streaming')}
          onSubmit={ask}
        />
      </div>
    </div>
  )
}
