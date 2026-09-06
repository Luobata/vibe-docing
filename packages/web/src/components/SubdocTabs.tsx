import { plainTextToProseMirror, type AnnotationRow, type NodeRow } from '@vibe/shared'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useApi } from '../api/context'
import {
  generationTaskKeys,
  generationTaskRegistry,
  useGenerationTasks,
  useWorkbench,
  type GenerationTask,
  type GenerationTaskStatus,
} from '../state/workbench-store'
import { DocView } from './DocView'
import { Icon } from './Icon'
import { CorrectiveMergeButton } from './CorrectiveMergeButton'
import { nodeTitle } from './TreePanel'
import { scrollMainDocumentToTop, transitionDocument } from '../flow/document-transition'
import { isSelectionSource } from './subdoc-classification'

export type GenerationBadgeStatus = Exclude<GenerationTaskStatus, 'complete'>

export interface GenerationBadgeState {
  key: string
  label: string
  status: GenerationBadgeStatus
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
}

function humanize(message: string): string {
  const detail = message.trim()
  if (/HTTP\s*(401|403)/.test(detail)) return 'AI 服务鉴权失败，请到高级设置检查 API 密钥。'
  if (/HTTP\s*5\d\d/.test(detail) || /answer failed/i.test(detail)) return 'AI 服务暂时不可用，当前关联内容已保留，可单独重试。'
  if (/fetch|network|Failed to fetch/i.test(detail)) return '网络连接中断，当前关联内容已保留，可单独重试。'
  return '关联内容生成中断，当前内容已保留，可单独重试。'
}

function generatedContent(text: string): Pick<NodeRow, 'ai_response' | 'document_content'> {
  const content = plainTextToProseMirror(text)
  return { ai_response: content, document_content: content }
}

export function generationBadgeState(
  node: NodeRow | undefined,
  task: GenerationTask | undefined,
): GenerationBadgeState | null {
  const status = task?.status === 'streaming' || task?.status === 'error' || task?.status === 'cancelled'
    ? task.status
    : node?.status === 'streaming' || node?.status === 'error' || node?.status === 'cancelled'
      ? node.status
      : null
  if (!status) return null
  const key = task?.key ?? generationTaskKeys.retry(node?.id ?? 'unknown')
  const label = status === 'streaming'
    ? task?.phase === 'stopping' ? '停止中' : '生成中'
    : status === 'error' ? '生成失败' : '已停止'
  return { key, label, status }
}

export function GenerationBadge({ state }: { state: GenerationBadgeState }) {
  return (
    <span
      className={`subdoc-task-indicator is-${state.status}`}
      data-gen-status={state.status}
      data-task-key={state.key}
    >
      <span aria-hidden="true" className="subdoc-task-icon">
        {state.status === 'streaming' ? null : <Icon name={state.status === 'error' ? 'alert' : 'close'} size={12} />}
      </span>
      <span>{state.label}</span>
    </span>
  )
}

export function SubdocTabs({
  annotations = [],
  emptyLabel = '还没有关联内容',
  nodeIds,
}: {
  annotations?: AnnotationRow[]
  emptyLabel?: string
  nodeIds?: string[]
}) {
  const api = useApi()
  const activeSubdocId = useWorkbench((state) => state.activeSubdocId)
  const anchoredSubdocId = useWorkbench((state) => state.anchoredSubdocId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const promoteSubdoc = useWorkbench((state) => state.promoteSubdoc)
  const setActiveSubdoc = useWorkbench((state) => state.setActiveSubdoc)
  const setAnchoredSubdocId = useWorkbench((state) => state.setAnchoredSubdocId)
  const setFocusedAnnotation = useWorkbench((state) => state.setFocusedAnnotation)
  const setMain = useWorkbench((state) => state.setMain)
  const subdocTabs = useWorkbench((state) => state.subdocTabs)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
  const [pendingStop, setPendingStop] = useState<{ key: string; runId: number } | null>(null)
  const [flashSubdocId, setFlashSubdocId] = useState<string | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const displayedNodeIds = nodeIds ?? subdocTabs
  const currentId = activeSubdocId && displayedNodeIds.includes(activeSubdocId)
    ? activeSubdocId
    : displayedNodeIds[0]
  const current = currentId ? nodesById[currentId] : undefined
  const currentTaskKey = currentId ? taskKeyByTarget[currentId] : undefined
  const currentTask = currentTaskKey ? tasksByKey[currentTaskKey] : undefined
  const currentBadge = generationBadgeState(current, currentTask)
  const currentSource = current
    ? annotations.find((item) => item.child_node_id === current.id)
    : undefined
  const currentSourceKind = currentSource
    ? isSelectionSource(currentSource) ? 'selection' : 'whole'
    : null

  function locateSource(nodeId: string): void {
    const source = annotations.find((item) =>
      item.child_node_id === nodeId && isSelectionSource(item),
    )
    if (!source) return
    setFocusedAnnotation(source.id)
    setAnchoredSubdocId(nodeId)
  }

  function activate(nodeId: string): void {
    setActiveSubdoc(nodeId)
    const source = annotations.find((item) => item.child_node_id === nodeId)
    if (isSelectionSource(source)) locateSource(nodeId)
  }

  function focusTab(nodeId: string): void {
    tabsRef.current
      ?.querySelector<HTMLButtonElement>(`[data-subdoc-id="${nodeId}"]`)
      ?.focus()
  }

  function handleTablistKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const currentIndex = currentId ? displayedNodeIds.indexOf(currentId) : -1
    let next = currentIndex
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (currentIndex + 1) % displayedNodeIds.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (currentIndex - 1 + displayedNodeIds.length) % displayedNodeIds.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = displayedNodeIds.length - 1
    else return
    event.preventDefault()
    const nextId = displayedNodeIds[next]
    if (!nextId || nextId === currentId) return
    activate(nextId)
    focusTab(nextId)
  }

  useEffect(() => {
    if (currentId && currentId !== activeSubdocId) setActiveSubdoc(currentId)
  }, [activeSubdocId, currentId, setActiveSubdoc])

  useEffect(() => {
    if (!pendingStop) return
    const task = tasksByKey[pendingStop.key]
    if (!task || task.runId !== pendingStop.runId || task.status === 'streaming') return
    const retry = cardRef.current?.querySelector<HTMLButtonElement>('[data-generation-retry="true"]')
    retry?.focus()
    setPendingStop(null)
  }, [pendingStop, tasksByKey])

  useEffect(() => {
    if (!anchoredSubdocId || !displayedNodeIds.includes(anchoredSubdocId)) return
    setActiveSubdoc(anchoredSubdocId)
    setFlashSubdocId(anchoredSubdocId)
    const target = Array.from(
      tabsRef.current?.querySelectorAll<HTMLButtonElement>('[data-subdoc-id]') ?? [],
    ).find((button) => button.dataset.subdocId === anchoredSubdocId)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target?.scrollIntoView?.({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
    cardRef.current?.scrollIntoView?.({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'nearest',
    })
    setAnchoredSubdocId(null)
    const timer = setTimeout(() => setFlashSubdocId(null), 10_000)
    return () => clearTimeout(timer)
  }, [anchoredSubdocId, displayedNodeIds, setActiveSubdoc, setAnchoredSubdocId])

  if (displayedNodeIds.length === 0) return <p className="empty-state">{emptyLabel}</p>

  async function retry(target: NodeRow, key: string): Promise<void> {
    const activeKey = generationTaskRegistry.getSnapshot().byTarget[target.id]
    const activeTask = activeKey
      ? generationTaskRegistry.getSnapshot().byKey[activeKey]
      : undefined
    if (activeTask?.status === 'streaming') return
    const question = target.user_input?.trim()
    if (!question) return
    let currentNode = target
    let text = ''
    const task = generationTaskRegistry.start({
      key,
      kind: 'retry',
      onCancelled() {
        useWorkbench.getState().upsertNode({ ...currentNode, status: 'cancelled' })
      },
      ownerMainNodeId: useWorkbench.getState().mainNodeId ?? target.parent_id ?? target.id,
      targetNodeId: target.id,
    })
    if (!task) return
    currentNode = { ...target, ...generatedContent(''), status: 'streaming' }
    useWorkbench.getState().upsertNode(currentNode)
    try {
      await api.streamAnswer(target.id, question, {
        onCancelled() {
          generationTaskRegistry.settle(task, 'cancelled')
        },
        onChunk(chunk) {
          if (!generationTaskRegistry.isTaskLive(task)) return
          generationTaskRegistry.patchPhase(task, 'replying')
          text += chunk
          currentNode = {
            ...target,
            ...generatedContent(text),
            status: 'streaming',
          }
          useWorkbench.getState().upsertNode(currentNode)
        },
        onDone(doneNode) {
          if (!generationTaskRegistry.isTaskLive(task) || doneNode.id !== target.id) return
          useWorkbench.getState().upsertNode(doneNode)
          generationTaskRegistry.settle(task, 'complete')
        },
        onError(message) {
          if (!generationTaskRegistry.isTaskLive(task)) return
          const readable = humanize(message)
          useWorkbench.getState().upsertNode({ ...currentNode, status: 'error' })
          generationTaskRegistry.settle(task, 'error', readable)
        },
      }, task.controller.signal)
      if (generationTaskRegistry.isTaskLive(task)) {
        const readable = 'AI 未返回完成状态，当前关联内容已保留，可单独重试。'
        useWorkbench.getState().upsertNode({ ...currentNode, status: 'error' })
        generationTaskRegistry.settle(task, 'error', readable)
      }
    } catch (error) {
      if (isAbortError(error, task.controller.signal)) {
        generationTaskRegistry.settle(task, 'cancelled')
      } else if (generationTaskRegistry.isTaskLive(task)) {
        const readable = humanize(error instanceof Error ? error.message : 'answer failed')
        useWorkbench.getState().upsertNode({ ...currentNode, status: 'error' })
        generationTaskRegistry.settle(task, 'error', readable)
      }
    }
  }

  return (
    <div className="subdoc-tabs-shell">
      <div aria-label="关联内容标签" className="subdoc-tabs" onKeyDown={handleTablistKeyDown} ref={tabsRef} role="tablist">
        {displayedNodeIds.map((id) => {
          const title = nodeTitle(nodesById[id])
          const taskKey = taskKeyByTarget[id]
          const task = taskKey ? tasksByKey[taskKey] : undefined
          const badge = generationBadgeState(nodesById[id], task)
          return (
            <button
              aria-controls="subdoc-panel"
              aria-label={badge ? `${title}，${badge.label}` : title}
              aria-selected={id === currentId}
              className={flashSubdocId === id ? 'is-anchor-flash' : undefined}
              data-gen-status={badge?.status}
              data-subdoc-id={id}
              data-task-key={badge?.key}
              id={`subdoc-tab-${id}`}
              key={id}
              onClick={() => activate(id)}
              role="tab"
              tabIndex={id === currentId ? 0 : -1}
              title={title}
              type="button"
            >
              <span className="subdoc-tab-label">{title}</span>
              {badge && <GenerationBadge state={badge} />}
            </button>
          )
        })}
      </div>
      {current && (
        <article aria-labelledby={currentId ? `subdoc-tab-${currentId}` : undefined} className={`subdoc-card${flashSubdocId === current.id ? ' is-anchor-flash' : ''}`} id="subdoc-panel" ref={cardRef} role="tabpanel">
          <header>
            <div className="subdoc-card-title">
              <h3>{nodeTitle(current)}</h3>
              {currentSourceKind === 'selection' && (
                <span className="subdoc-source-label" data-source-kind="selection">
                  基于：选中的原文
                </span>
              )}
              {currentSourceKind === 'whole' && (
                <span className="subdoc-source-label" data-source-kind="whole">
                  基于：整篇笔记 · 无具体原文位置
                </span>
              )}
              {currentBadge && (
                <span
                  aria-live="polite"
                  data-gen-status={currentBadge.status}
                  data-task-key={currentBadge.key}
                  role="status"
                >
                  <GenerationBadge state={currentBadge} />
                </span>
              )}
            </div>
            <div className="subdoc-card-actions">
              {currentTask?.status === 'streaming' && (
                <button
                  aria-label={`停止生成：${nodeTitle(current)}`}
                  className="quiet-button subdoc-stop-button"
                  data-gen-status="streaming"
                  data-task-key={currentTask.key}
                  disabled={currentTask.phase === 'stopping'}
                  onClick={() => {
                    setPendingStop({ key: currentTask.key, runId: currentTask.runId })
                    generationTaskRegistry.stop(currentTask.key)
                  }}
                  type="button"
                >
                  {currentTask.phase === 'stopping' ? '停止中' : '停止'}
                </button>
              )}
              <button
                aria-label="设为主文档"
                className="primary-button"
                onClick={() => transitionDocument(() => {
                  promoteSubdoc(current.id)
                  scrollMainDocumentToTop()
                })}
                type="button"
              >
                聚焦此文档
              </button>
              {currentSourceKind === 'selection' && (
                <button className="quiet-button" onClick={() => locateSource(current.id)} type="button">
                  定位原文
                </button>
              )}
              {currentSourceKind === 'whole' && current.parent_id && (
                <button
                  className="quiet-button"
                  onClick={() => { if (current.parent_id) setMain(current.parent_id) }}
                  type="button"
                >
                  查看主文档
                </button>
              )}
            </div>
          </header>
          <DocView
            annotations={[]}
            errorText={currentTask?.error ?? undefined}
            generationTaskKey={currentBadge?.key}
            node={current}
            onRetry={(key) => { void retry(current, key) }}
            onSelect={() => {}}
            retryDisabled={currentTask?.status === 'streaming'}
            retryTaskKey={generationTaskKeys.retry(current.id)}
          />
          {current.parent_id && (
            <CorrectiveMergeButton
              sourceNodeId={current.id}
              targetNodeId={current.parent_id}
            />
          )}
        </article>
      )}
    </div>
  )
}
