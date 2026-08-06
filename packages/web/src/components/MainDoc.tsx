import {
  plainTextToProseMirror,
  type AnnotationRow,
  type NodeRow,
} from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { Api } from '../api/client'
import type { PlainSelection } from '../doc/selection'
import {
  decideRouteUi,
  nextTempId,
  resolveMigrationParent,
  type RouteUi,
} from '../flow/answer-flow'
import { parallelAsk } from '../flow/parallel-ask'
import { useWorkbench } from '../state/workbench-store'
import { AnnotationBubble } from './AnnotationBubble'
import { ChatBox } from './ChatBox'
import { DocView } from './DocView'
import { RoutePrompt } from './RoutePrompt'

export function MainDoc() {
  const api = useApi()
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const openSubdocTab = useWorkbench((state) => state.openSubdocTab)
  const setMain = useWorkbench((state) => state.setMain)
  const setRouteState = useWorkbench((state) => state.setRouteState)
  const setToast = useWorkbench((state) => state.setToast)
  const treeId = useWorkbench((state) => state.treeId)
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const [answerNodeId, setAnswerNodeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<PlainSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  const [migratedParentId, setMigratedParentId] = useState<string | null>(null)
  const [optimisticNode, setOptimisticNode] = useState<NodeRow | null>(null)
  const [routeUi, setRouteUi] = useState<RouteUi>({ action: 'none' })

  useEffect(() => {
    let active = true
    setAnnotations([])
    setSelection(null)
    setError(null)
    setAnswerNodeId(null)
    setLastQuestion('')
    setMigratedParentId(null)
    setOptimisticNode(null)
    setRouteUi({ action: 'none' })
    if (!mainNodeId) return () => { active = false }
    const getNode = (api as Partial<Api>).getNode
    if (!getNode) return () => { active = false }
    void getNode(mainNodeId)
      .then((result) => {
        if (!active) return
        setAnnotations(result.annotations)
        upsertNode(result.node)
      })
      .catch(() => {
        if (active) setError('无法刷新文档详情，正在显示本地内容。')
      })
    return () => { active = false }
  }, [api, mainNodeId, upsertNode])

  if (!mainNodeId) return <div className="document-placeholder" data-testid="main-doc-empty">选择或新建一棵树开始</div>
  const node = nodesById[mainNodeId]
  if (!node) return <div className="inline-error" role="alert">当前文档不存在</div>

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

  async function ask(question: string): Promise<void> {
    if (!treeId || busy) return
    const optimisticParentId = node.id
    let answerText = ''
    let currentAnswer: NodeRow = {
      ...node,
      ai_response: plainTextToProseMirror(''),
      id: nextTempId(),
      parent_id: optimisticParentId,
      status: 'streaming',
      user_input: question,
    }
    setBusy(true)
    setError(null)
    setLastQuestion(question)
    setMigratedParentId(null)
    setRouteUi({ action: 'none' })
    setOptimisticNode(currentAnswer)

    try {
      const forked = await api.fork(optimisticParentId, {
        anchorFrom: null,
        anchorTo: null,
        kind: 'whole',
        quotedText: null,
        seedText: question,
        treeId,
      })
      const prepared = await api.editNode(forked.childNode.id, { userInput: question })
      currentAnswer = {
        ...prepared.node,
        ai_response: plainTextToProseMirror(''),
        status: 'streaming',
      }
      setAnswerNodeId(currentAnswer.id)
      setOptimisticNode(currentAnswer)
      upsertNode(currentAnswer)
      openSubdocTab(currentAnswer.id)

      await parallelAsk({ api }, { answerNodeId: currentAnswer.id, question }, {
        onChunk(chunk) {
          answerText += chunk
          currentAnswer = {
            ...currentAnswer,
            ai_response: plainTextToProseMirror(answerText),
            status: 'streaming',
          }
          setOptimisticNode(currentAnswer)
          upsertNode(currentAnswer)
        },
        onDone(doneNode) {
          currentAnswer = doneNode
          setOptimisticNode(doneNode)
          upsertNode(doneNode)
        },
        onError(message) {
          currentAnswer = { ...currentAnswer, status: 'error' }
          setOptimisticNode(currentAnswer)
          upsertNode(currentAnswer)
          setError(`生成中断：${message}`)
        },
        onRoute(convergence) {
          setRouteState(currentAnswer.id, convergence)
          setRouteUi(decideRouteUi(convergence))
        },
      })
    } catch (cause) {
      currentAnswer = { ...currentAnswer, status: 'error' }
      setOptimisticNode(currentAnswer)
      setError(cause instanceof Error ? `提问失败：${cause.message}` : '提问失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function migrate(candidate: Parameters<typeof resolveMigrationParent>[0]): Promise<void> {
    if (!answerNodeId) return
    const newParentId = resolveMigrationParent(candidate, node.id)
    setError(null)
    try {
      const result = await api.migrate(answerNodeId, {
        newParentId,
        seedText: lastQuestion,
        target: candidate.target,
      })
      upsertNode(result.node)
      if (nodesById[newParentId]?.parent_id === node.id) openSubdocTab(newParentId)
      setMigratedParentId(result.node.parent_id)
      setRouteUi({ action: 'none' })
      setToast('已迁移，回答内容未重新生成。')
    } catch {
      setError('迁移失败，回答仍保留在主文档下。')
    }
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
      <DocView annotations={annotations} node={node} onRetry={() => { void retryCurrent() }} onSelect={setSelection} />
      {selection && (
        <AnnotationBubble
          onCreateNote={() => setSelection(null)}
          onDismiss={() => setSelection(null)}
          onForkExpand={(question) => { void forkExpand(question) }}
          selection={selection}
        />
      )}
      {optimisticNode && optimisticNode.id !== node.id && (
        <section aria-label="本轮回答" className="optimistic-answer">
          <span className="eyebrow">本轮回答 · 主文档延续</span>
          <DocView
            annotations={[]}
            node={optimisticNode}
            onRetry={() => { void ask(lastQuestion) }}
            onSelect={() => {}}
          />
        </section>
      )}
      <RoutePrompt
        decision={routeUi}
        onAccept={(candidate) => { void migrate(candidate) }}
        onDismiss={() => setRouteUi({ action: 'none' })}
        onPick={(candidate) => { void migrate(candidate) }}
      />
      {migratedParentId && migratedParentId !== node.id && (
        <button className="migration-link" onClick={() => setMain(migratedParentId)} type="button">
          查看迁移位置
        </button>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <ChatBox disabled={busy} onSubmit={(question) => { void ask(question) }} />
    </div>
  )
}
