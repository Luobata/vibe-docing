import type { DocumentShareView, NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, type SynthesisStreamHandlers } from '../api/client'
import { ApiProvider } from '../api/context'
import type { Decisions, OpenQuestion, Synthesis } from '../api/types'
import { useWorkbench } from '../state/workbench-store'
import { SynthesisPanel } from './SynthesisPanel'

const node: NodeRow = { id: 'note', tree_id: 'tree', parent_id: null, user_input: '主文档', ai_response: null, document_content: '原始正文', content_schema_version: 2, status: 'complete', is_deleted: 0, sort_order: 0, model_override: null, created_at: '', updated_at: '', verdict: null }
const child = { ...node, id: 'child', parent_id: node.id, user_input: '路线甲' }
const titles = ['背景', '核心分歧', '决策与理由', '被否决方案及原因', '风险', '开放问题']
const synthesis = (id: string, status: Synthesis['status'] = 'done'): Synthesis => ({
  id, treeId: 'tree', status, contentMd: status === 'done' ? titles.map((title) => `## ${title}\n\n**证据 ${title}** [^1]`).join('\n\n') : null,
  sections: titles.map((title) => ({ key: title, title, content: `证据 ${title}` })),
  footnotes: [{ number: 1, nodeId: 'note', title: '主文档', path: ['主文档'] }, { number: 2, nodeId: 'child', title: '路线甲', path: ['主文档', '路线甲'] }],
  nodeResults: status === 'done' ? { note: { nodeId: 'note', cacheKey: 'k1', status: 'done', content: 'Summary' }, child: { nodeId: 'child', cacheKey: 'k2', status: 'done', content: 'Option' } } : {},
  inputDigest: id, error: null, createdAt: id === 'old' ? '2026-09-13T00:00:00Z' : '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z', finishedAt: status === 'done' ? '2026-09-14T00:00:00Z' : null,
})
const question: OpenQuestion = { id: 'q1', tree_id: 'tree', node_id: 'note', question: '采用哪个方案？', status: 'open', source: 'ai', resolved_at: null, created_at: '', updated_at: '' }

function setup(initial: Synthesis[] = []) {
  let records = initial
  let share: DocumentShareView | null = null
  let log: Decisions = { merges: [{ id: 'merge', source_node_id: 'child', target_node_id: 'note', conclusion: '保留原有合并理由', landing_segment_id: null, kind: 'summary', direction: null, created_at: '' }], nodes: [] }
  let handlers!: SynthesisStreamHandlers
  let observedSignal: AbortSignal | undefined
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const api = {
    ...createApi(),
    listSyntheses: vi.fn(async () => ({ syntheses: records })),
    getSynthesis: vi.fn(async (id: string) => ({ synthesis: records.find((item) => item.id === id)! })),
    synthesize: vi.fn(async (_treeId: string, listener: SynthesisStreamHandlers, signal?: AbortSignal) => {
      handlers = listener; observedSignal = signal
      signal?.addEventListener('abort', () => { listener.onCancelled(); release() }, { once: true })
      await pending
    }),
    cancelSynthesis: vi.fn(async (id: string): Promise<{ synthesis: Synthesis }> => {
      const item = { ...records.find((record) => record.id === id)!, status: 'cancelled' as const }
      records = [item, ...records.filter((record) => record.id !== id)]
      return { synthesis: item }
    }),
    diffSyntheses: vi.fn(async () => ({ lines: [{ type: 'del' as const, text: '旧结论' }, { type: 'add' as const, text: '新结论' }] })),
    getSynthesisShare: vi.fn(async () => ({ share })),
    createSynthesisShare: vi.fn(async (id: string) => {
      share = { enabled: true as const, nodeId: 'note', synthesisId: id, url: '/share/token', markdownUrl: '/share/token.md', jsonUrl: '/share/token.json', createdAt: '', updatedAt: '' }
      return { share }
    }),
    revokeSynthesisShare: vi.fn(async () => { share = null; return { ok: true as const } }),
    listOpenQuestions: vi.fn(async () => ({ questions: [] as OpenQuestion[] })),
    extractOpenQuestions: vi.fn(async () => ({ questions: [question] })),
    updateOpenQuestion: vi.fn(async (_id: string, patch: { status?: 'open' | 'resolved' }) => ({ question: { ...question, ...patch, resolved_at: patch.status === 'resolved' ? 'now' : null } })),
    getRetrospective: vi.fn(async () => ({ retrospective: null })),
    createRetrospective: vi.fn(async () => ({ retrospective: { id: 'r', tree_id: 'tree', input_digest: 'digest', content_md: '## 回顾摘要\n继续验证假设。', created_at: '' }, cached: true })),
    listDecisions: vi.fn(async () => log),
    setNodeVerdict: vi.fn(async (id: string, verdict: NodeRow['verdict']) => {
      const result = { ...(id === 'note' ? node : child), verdict }
      log = { ...log, nodes: verdict ? [result] : [] }
      return { node: result }
    }),
  }
  const view = render(<ApiProvider api={api}><SynthesisPanel key={node.tree_id} node={node} /></ApiProvider>)
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: '成文与讨论经营' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
  }
  const start = async (item = synthesis('new', 'running')) => {
    fireEvent.click(screen.getByRole('button', { name: initial.length ? '重新成文' : '一键成文' }))
    await waitFor(() => expect(api.synthesize).toHaveBeenCalledOnce())
    records = [item, ...records]
    act(() => handlers.onStarted(item, 2))
  }
  const done = async (item = synthesis('new')) => {
    records = [item, ...records.filter((row) => row.id !== item.id)]
    await act(async () => { handlers.onDone(item); release(); await pending })
    await waitFor(() => expect(screen.getByRole('button', { name: '重新成文' })).toBeEnabled())
  }
  return { api, view, open, start, done, release, pending, getSignal: () => observedSignal, emit: (work: (listener: SynthesisStreamHandlers) => void) => act(() => work(handlers)), setRecords: (items: Synthesis[]) => { records = items } }
}

beforeEach(() => {
  useWorkbench.getState().reset()
  useWorkbench.getState().loadTree({ treeId: 'tree', rootNodeId: 'note', nodes: [node, child] })
})

describe('SynthesisPanel', () => {
  it('loads on opening, streams progress and six chapters, and navigates source lineage through the existing store', async () => {
    const context = setup()
    expect(context.api.listSyntheses).not.toHaveBeenCalled()
    await context.open()
    await context.start()
    context.emit((listener) => listener.onProgress({ synthesisId: 'new', nodeId: 'note', status: 'done', completed: 1, total: 2, failed: 0, cached: true }))
    expect(screen.getByRole('progressbar', { name: '成文进度' })).toHaveValue(1)
    expect(screen.getByRole('button', { name: '正在成文…' })).toBeDisabled()
    context.emit((listener) => listener.onPhase())
    expect(screen.getByText(/正在综合六个章节/)).toBeInTheDocument()
    await context.done()
    for (const title of titles) expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1)
    expect(screen.getByText('证据 背景').tagName).toBe('STRONG')
    fireEvent.click(screen.getByText('来源 (2)'))
    fireEvent.click(screen.getByRole('button', { name: '[^2] 路线甲' }))
    expect(useWorkbench.getState().mainNodeId).toBe('child')
  })

  it('shows SYNTHESIS_RUNNING inline and loads the existing job without reconnecting', async () => {
    const context = setup()
    await context.open()
    const existing = synthesis('existing', 'running')
    context.setRecords([existing])
    context.api.synthesize.mockRejectedValueOnce(new ApiError(409, { code: 'SYNTHESIS_RUNNING', synthesisId: 'existing' }))
    fireEvent.click(screen.getByRole('button', { name: '一键成文' }))
    expect(await screen.findByText('已有成文任务进行中')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
    expect(context.api.getSynthesis).toHaveBeenCalledWith('existing')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新成文' })).toBeDisabled()
    expect(context.api.synthesize).toHaveBeenCalledOnce()
  })

  it('shows persisted running progress on entry and refreshes completed content only on an action', async () => {
    const item = { ...synthesis('existing', 'running'), nodeResults: { note: synthesis('existing').nodeResults.note } }
    const context = setup([item])
    await context.open()
    expect(screen.getByText(/已处理 1 \/ 2 个节点/)).toBeInTheDocument()
    expect(context.api.synthesize).not.toHaveBeenCalled()
    context.setRecords([synthesis('existing')])
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByRole('heading', { name: '背景' })).toBeInTheDocument()
    expect(context.api.synthesize).not.toHaveBeenCalled()
  })

  it('automatically renders server diff after rerun and can compare a selected history pair', async () => {
    const context = setup([synthesis('old')])
    await context.open()
    await context.start()
    await context.done()
    expect(context.api.diffSyntheses).toHaveBeenCalledWith('new', 'old')
    const diff = await screen.findByLabelText('成文版本差异')
    expect(diff.querySelector('[data-type="del"]')).toHaveTextContent('− 旧结论')
    expect(diff.querySelector('[data-type="add"]')).toHaveTextContent('+ 新结论')
    fireEvent.change(screen.getByRole('combobox', { name: '成文历史' }), { target: { value: 'old' } })
    fireEvent.change(screen.getByRole('combobox', { name: '对比成文版本' }), { target: { value: 'new' } })
    fireEvent.click(screen.getByRole('button', { name: '查看差异' }))
    await waitFor(() => expect(context.api.diffSyntheses).toHaveBeenLastCalledWith('old', 'new'))
  })

  it('creates, copies and revokes a share without persisting its URL', async () => {
    const context = setup([synthesis('old')])
    const writeText = vi.fn(async () => {})
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    try {
      await context.open()
      await waitFor(() => expect(screen.getByRole('button', { name: '创建分享' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: '创建分享' }))
      expect(await screen.findByRole('textbox', { name: '成文分享链接' })).toHaveValue(`${window.location.origin}/share/token`)
      fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
      expect(await screen.findByText('分享链接已复制')).toBeInTheDocument()
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/token`)
      expect(storage).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '撤销分享' }))
      expect(await screen.findByText('分享已撤销')).toBeInTheDocument()
      expect(context.api.revokeSynthesisShare).toHaveBeenCalledWith('old')
      expect(screen.queryByRole('textbox', { name: '成文分享链接' })).not.toBeInTheDocument()
    } finally {
      storage.mockRestore()
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('shows extraction loading, resolves and reopens questions, and allows another extraction', async () => {
    const context = setup()
    await context.open()
    fireEvent.click(screen.getByRole('button', { name: '开放问题' }))
    let finish!: (value: { questions: OpenQuestion[] }) => void
    context.api.extractOpenQuestions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '抽取开放问题' }))
    expect(screen.getByRole('button', { name: '正在抽取问题…' })).toBeDisabled()
    await act(async () => { finish({ questions: [question] }) })
    expect(screen.getByText(question.question)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '解决' }))
    expect(await screen.findByText('已解决')).toBeInTheDocument()
    expect(context.api.updateOpenQuestion).toHaveBeenLastCalledWith('q1', { status: 'resolved' })
    fireEvent.click(screen.getByRole('button', { name: '重开' }))
    expect(await screen.findByText('待解决')).toBeInTheDocument()
    expect(context.api.updateOpenQuestion).toHaveBeenLastCalledWith('q1', { status: 'open' })
    fireEvent.click(screen.getByRole('button', { name: '抽取开放问题' }))
    await waitFor(() => expect(context.api.extractOpenQuestions).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText(question.question)).toHaveLength(1)
  })

  it('shows manual retrospective loading and the returned cache indicator', async () => {
    const context = setup()
    await context.open()
    fireEvent.click(screen.getByRole('button', { name: '断点回顾' }))
    let finish!: (value: Awaited<ReturnType<typeof context.api.createRetrospective>>) => void
    context.api.createRetrospective.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '生成回顾' }))
    expect(screen.getByRole('button', { name: '正在回顾…' })).toBeDisabled()
    await act(async () => { finish({ retrospective: { id: 'r', tree_id: 'tree', input_digest: 'd', content_md: '## 回顾摘要\n继续验证假设。', created_at: '' }, cached: true }) })
    expect(screen.getByRole('heading', { name: '回顾摘要' })).toBeInTheDocument()
    expect(screen.getByText('已使用缓存')).toBeInTheDocument()
    expect(context.api.createRetrospective).toHaveBeenCalledWith('tree', expect.any(AbortSignal))
  })

  it('sets and clears verdict through the existing node store and reloads the decision log', async () => {
    const context = setup()
    await context.open()
    fireEvent.click(screen.getByRole('button', { name: '决策日志' }))
    expect(screen.getByText('保留原有合并理由')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '文档决策状态' }), { target: { value: 'adopted' } })
    await waitFor(() => expect(useWorkbench.getState().nodesById.note.verdict).toBe('adopted'))
    await waitFor(() => expect(context.api.listDecisions).toHaveBeenCalledTimes(2))
    expect(within(screen.getByLabelText('决策日志区')).getByText('主文档', { selector: 'button' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: '文档决策状态' })).toBeEnabled())
    fireEvent.change(screen.getByRole('combobox', { name: '文档决策状态' }), { target: { value: '' } })
    await waitFor(() => expect(useWorkbench.getState().nodesById.note.verdict).toBeNull())
    expect(context.api.setNodeVerdict).toHaveBeenLastCalledWith('note', null)
  })

  it('cancels the persisted task and aborts its request, keeping completed nodes visible', async () => {
    const context = setup()
    await context.open()
    await context.start({ ...synthesis('new', 'running'), nodeResults: { note: synthesis('new').nodeResults.note } })
    fireEvent.click(screen.getByRole('button', { name: '停止成文' }))
    expect(await screen.findByText('已停止，重新成文可复用已完成节点')).toBeInTheDocument()
    await waitFor(() => expect(context.getSignal()?.aborted).toBe(true))
    expect(context.api.cancelSynthesis).toHaveBeenCalledWith('new')
    expect(screen.getByText(/已处理 1 \/ 2 个节点/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '重新成文' })).toBeEnabled())
  })

  it('preserves completion when the task finishes before cancellation reaches the server', async () => {
    const context = setup()
    await context.open()
    await context.start()
    const finished = synthesis('new')
    context.setRecords([finished])
    context.api.cancelSynthesis.mockResolvedValueOnce({ synthesis: finished })
    fireEvent.click(screen.getByRole('button', { name: '停止成文' }))
    expect(await screen.findByText('成文已完成')).toBeInTheDocument()
    expect(context.getSignal()?.aborted).toBe(false)
    expect(screen.queryByText('已停止，重新成文可复用已完成节点')).not.toBeInTheDocument()
    await context.done(finished)
    expect(screen.getByRole('heading', { name: '背景' })).toBeInTheDocument()
  })

  it('aborts on unmount and does not let a late result update the store or issue a reconnect', async () => {
    const context = setup()
    await context.open()
    await context.start()
    context.view.unmount()
    expect(context.getSignal()?.aborted).toBe(true)
    await act(async () => { context.release(); await context.pending })
    expect(context.api.synthesize).toHaveBeenCalledOnce()
    expect(context.api.listSyntheses).toHaveBeenCalledOnce()
    expect(useWorkbench.getState().nodesById.note.document_content).toBe('原始正文')
  })

  it('renders provider failure details and retains the failed task for retry', async () => {
    const context = setup()
    await context.open()
    await context.start()
    const failed = { ...synthesis('new', 'failed'), error: '模型暂时不可用' }
    context.setRecords([failed])
    await act(async () => { context.emit((listener) => listener.onError('模型暂时不可用', failed)); context.release(); await context.pending })
    expect(screen.getByRole('alert')).toHaveTextContent('模型暂时不可用')
    await waitFor(() => expect(screen.getByRole('button', { name: '重新成文' })).toBeEnabled())
  })
})
