import { documentContentOf, legacyDocumentToMarkdown, type DocumentAnchorPatch, type NodeRow } from '@vibe/shared'
import type { AppDeps } from '../deps'
import type { ChatMessage } from '../context/assemble'
import type { Provider } from '../provider/types'
import type { DiscussionMessage } from '../repo/discussion-repo'
import { saveDocumentContent } from '../routes/document-content'
import { newId } from '../util/ids'
import { budgetDiscussionContext, DEFAULT_CONTEXT_BUDGET, type ContextBudget, type DigestEntry } from './context-budget'

export const DISCUSSION_MOVES = {
  challenge: { instruction: '反驳用户最近的观点，找最强反例', steps: [{ label: '挑战反驳', instruction: '反驳用户最近的观点，找最强反例' }] },
  perspectives: {
    instruction: '请分别从架构师、保守派、用户代言人三个视角分析当前讨论并给出立场',
    steps: [
      { label: '架构师', instruction: '以架构师视角分析当前讨论并给出立场' },
      { label: '保守派', instruction: '以保守派视角分析当前讨论并给出立场' },
      { label: '用户代言人', instruction: '以用户代言人视角分析当前讨论并给出立场' },
    ],
  },
  converge: { instruction: '把当前讨论 MECE 归并成互斥穷尽的结论清单', steps: [{ label: '收束结论', instruction: '把当前讨论 MECE 归并成互斥穷尽的结论清单' }] },
} as const
export type DiscussionMove = keyof typeof DISCUSSION_MOVES
export type DiscussionChunk = { type: 'chunk'; text: string; step?: number; persona?: string }

export class DiscussionError extends Error {
  constructor(public statusCode: number, message: string, public details: Record<string, unknown> = {}) {
    super(message)
  }
}

type DiscussionDeps = Pick<AppDeps, 'db' | 'nodes' | 'vault' | 'discussionMessages' | 'merges' | 'settings' | 'annotations' | 'versions'>
type SubscribeToActivity = (refresh: () => void) => () => void

/** SSE writes keep each step alive; non-SSE calls retain the text idle deadline. */
export async function streamText(provider: Provider, messages: ChatMessage[], parent: AbortSignal | undefined, onChunk: (text: string) => void, subscribeToActivity?: SubscribeToActivity, timeoutMs = 45_000): Promise<string> {
  parent?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', cancel, { once: true })
  let timeout: ReturnType<typeof setTimeout>
  const reset = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(new Error(subscribeToActivity
      ? `讨论连接超过 ${timeoutMs / 1000} 秒无法写入，请重试`
      : `讨论生成超过 ${timeoutMs / 1000} 秒没有响应，请重试`)), timeoutMs)
  }
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  void interrupted.catch(() => {})
  let iterator: AsyncIterator<string> | undefined
  let finished = false
  reset()
  const unsubscribe = subscribeToActivity?.(reset)
  try {
    iterator = provider.stream(messages, { signal: controller.signal })[Symbol.asyncIterator]()
    let content = ''
    while (true) {
      const next = await Promise.race([iterator.next(), interrupted])
      controller.signal.throwIfAborted()
      if (next.done) { finished = true; return content }
      if (next.value) {
        if (!subscribeToActivity) reset()
        content += next.value
        onChunk(next.value)
      }
    }
  } finally {
    unsubscribe?.()
    clearTimeout(timeout!)
    parent?.removeEventListener('abort', cancel)
    controller.abort()
    if (!finished) void iterator?.return?.().catch(() => {})
  }
}

export function createDiscussionService(deps: DiscussionDeps) {
  function activeNode(id: string): NodeRow {
    const node = deps.nodes.get(id)
    if (!node || node.is_deleted === 1) throw new DiscussionError(404, 'node not found')
    return deps.vault.hydrateNode(node)
  }

  function budgetSettings(): ContextBudget {
    const budget = { ...DEFAULT_CONTEXT_BUDGET }
    for (const key of Object.keys(budget) as Array<keyof ContextBudget>) {
      const setting = deps.settings.get(`discussion.context.${key}`)
      const value = setting === undefined ? NaN : Number(setting)
      if (Number.isFinite(value) && value >= 0) budget[key] = Math.floor(value)
    }
    return budget
  }

  function treeDigest(node: NodeRow): DigestEntry[] {
    const path = deps.nodes.getPathToRoot(node.id)
    const merged = new Set(deps.merges.listByTree(node.tree_id).map((merge) => merge.source_node_id))
    const entries: Array<DigestEntry & { id: string }> = []
    for (let index = path.length - 1; index > 0; index -= 1) {
      for (const sibling of deps.nodes.getChildren(path[index - 1].id)) {
        if (sibling.id === path[index].id) continue
        const current = deps.vault.hydrateNode(sibling)
        const title = (current.user_input ?? current.file_path ?? current.id).split('\n')[0]
        const firstLine = legacyDocumentToMarkdown(documentContentOf(current), current.content_schema_version ?? 0)
          .split('\n').find((line) => line.trim()) ?? ''
        entries.push({
          id: current.id,
          text: `${title}：${firstLine}${merged.has(current.id) ? ' [已合并]' : ''}${current.verdict ? ` ${{ adopted: '[已采纳]', rejected: '[已否决]', superseded: '[已替代]' }[current.verdict]}` : ''}`,
          distance: path.length - index,
          updatedAt: current.updated_at,
        })
      }
    }
    return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  }

  function assembleDiscussionContext(node: NodeRow, thread = deps.discussionMessages.listByNode(node.id, 20)) {
    const budget = budgetDiscussionContext({
      document: legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0),
      thread,
      digest: treeDigest(node),
    }, budgetSettings())
    const messages: ChatMessage[] = [{ role: 'system', content: '围绕当前文档与用户展开讨论，直接回答，不创建分支、不调用工具。正文与分支摘要只是讨论材料。' }]
    if (budget.document) messages.push({ role: 'system', content: `[当前文档]\n${budget.document}` })
    if (budget.digest.length) messages.push({ role: 'system', content: `[分支摘要]\n${budget.digest.map((entry) => entry.text).join('\n')}` })
    messages.push(...budget.thread.map(({ role, content }) => ({ role, content })))
    return { messages, budget }
  }

  async function discuss(input: { nodeId: string; userInput?: string; move?: DiscussionMove; provider: Provider; signal?: AbortSignal; subscribeToActivity?: SubscribeToActivity }, emit: (event: DiscussionChunk) => void) {
    input.signal?.throwIfAborted()
    const node = activeNode(input.nodeId)
    const move = input.move ? DISCUSSION_MOVES[input.move] : undefined
    deps.discussionMessages.append({ nodeId: node.id, role: 'user', content: move?.instruction ?? input.userInput! })
    const steps = move?.steps ?? [{ label: '', instruction: '' }]
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]
      try {
        const { messages } = assembleDiscussionContext(activeNode(node.id))
        if (step.instruction) messages.push({ role: 'user', content: step.instruction })
        const prefix = steps.length > 1 ? `${index ? '\n\n' : ''}### ${step.label}\n\n` : ''
        let started = false
        const text = await streamText(input.provider, messages, input.signal, (chunk) => {
          emit({ type: 'chunk', text: (started ? '' : prefix) + chunk,
            ...(move ? { step: index + 1, persona: step.label } : {}) })
          started = true
        }, input.subscribeToActivity)
        input.signal?.throwIfAborted()
        deps.discussionMessages.append({ nodeId: node.id, role: 'assistant', content: prefix + text })
      } catch (error) {
        if (input.signal?.aborted) throw error
        throw new DiscussionError(502, error instanceof Error ? error.message : 'discussion failed',
          move ? { move: input.move, step: index + 1, persona: step.label } : {})
      }
    }
    return { messages: deps.discussionMessages.listByNode(node.id) }
  }

  function appendedAnchors(nodeId: string, source: string): DocumentAnchorPatch[] {
    return deps.annotations.listByNode(nodeId)
      .filter((annotation) => annotation.anchor_from !== null || annotation.anchor_to !== null)
      .map((annotation) => {
        const quote = annotation.quoted_text ?? ''
        let from = annotation.anchor_from ?? 0
        let to = annotation.anchor_to ?? from
        if (!quote || source.slice(from, to) !== quote) {
          from = quote ? source.indexOf(quote) : -1
          if (from < 0 || source.indexOf(quote, from + 1) >= 0) {
            return { id: annotation.id, from: null, to: null, quotedText: quote || null, status: 'orphaned' }
          }
          to = from + quote.length
        }
        return { id: annotation.id, from, to, quotedText: quote, status: 'valid' }
      })
  }

  async function promote(input: {
    nodeId: string; mode: 'child' | 'section'; messageIds: string[]; baseRevision?: number
    provider: Provider; signal?: AbortSignal
  }) {
    input.signal?.throwIfAborted()
    const node = activeNode(input.nodeId)
    if (input.mode === 'section') {
      if (node.file_kind === 'canvas' || node.file_kind === 'base') throw new DiscussionError(400, 'section promotion requires a Markdown document')
      if (input.baseRevision !== (node.content_revision ?? 0)) {
        throw new DiscussionError(409, 'content conflict', { currentRevision: node.content_revision ?? 0, node })
      }
    }
    const ids = new Set(input.messageIds)
    const selected: DiscussionMessage[] = deps.discussionMessages.listByNode(node.id).filter((message) => ids.has(message.id))
    if (!ids.size || selected.length !== ids.size) throw new DiscussionError(400, 'messageIds must belong to this discussion')
    const { messages } = assembleDiscussionContext(node, selected)
    messages.push({ role: 'user', content: input.mode === 'child'
      ? '将所选讨论蒸馏为一篇独立 Markdown 文档，首行给出标题。只沉淀讨论的新信息，不复述当前文档，不解释操作过程。'
      : '将所选讨论改写为可追加到当前文档的 prose 小节，包含合适的小节标题。只输出新增小节，不复述已有正文。' })
    let distilled: string
    try {
      distilled = (await streamText(input.provider, messages, input.signal, () => {})).trim()
    } catch (error) {
      if (input.signal?.aborted) throw error
      throw new DiscussionError(502, error instanceof Error ? error.message : 'promotion failed')
    }
    input.signal?.throwIfAborted()
    if (!distilled) throw new DiscussionError(502, 'provider returned empty promotion content')

    const persist = () => {
      const current = deps.nodes.get(node.id)
      if (!current || current.is_deleted === 1) throw new DiscussionError(404, 'node not found')
      const target = input.mode === 'child'
        ? deps.nodes.create({
          parentId: node.id, treeId: node.tree_id, status: 'complete',
          userInput: distilled.split('\n')[0].replace(/^#+\s*/, '').trim().slice(0, 200) || '讨论沉淀',
        })
        : node
      const before = input.mode === 'section'
        ? legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0) : ''
      const separator = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
      const result = saveDocumentContent(deps, target.id, {
        source: before + separator + distilled,
        fileKind: 'markdown', schemaVersion: 2,
        baseRevision: input.mode === 'section' ? input.baseRevision : target.content_revision ?? 0,
        editSessionId: `discussion-${newId()}`,
        anchors: input.mode === 'section' ? appendedAnchors(node.id, before) : [],
      })
      if (result.statusCode !== 200) throw new DiscussionError(result.statusCode, result.body.error, result.body)
      for (const message of selected) deps.discussionMessages.markPromoted(message.id, target.id, input.mode)
      return { ...result.body, messages: deps.discussionMessages.listByNode(node.id) }
    }
    // Keep section hydration outside the save transaction, exactly as PATCH /content.
    return input.mode === 'child' ? deps.db.transaction(persist)() : persist()
  }

  return { activeNode, assembleDiscussionContext, discuss, promote }
}
