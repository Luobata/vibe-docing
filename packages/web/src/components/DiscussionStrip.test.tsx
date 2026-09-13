import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, type DiscussionMessage } from '../api/client'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { DiscussionStrip } from './DiscussionStrip'

const node: NodeRow = {
  id: 'note', parent_id: null, tree_id: 'tree', user_input: 'Note', status: 'complete',
  ai_response: null, document_content: '正文', content_schema_version: 2, content_revision: 5,
  created_at: '', updated_at: '', model_override: null, sort_order: 0, is_deleted: 0,
}
const message = (id: string, role: 'user' | 'assistant', content: string): DiscussionMessage => ({
  id, node_id: node.id, role, content, created_at: '', promoted_mode: null, promoted_node_id: null,
})
const initial = [message('u1', 'user', '从哪里开始？'), message('a1', 'assistant', '先验证关键假设。')]

function setup() {
  let source!: ReadableStreamDefaultController<Uint8Array>
  let signal: AbortSignal | null | undefined
  const cancel = vi.fn()
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller }, cancel }))
  }) as typeof fetch
  const client = createApi({ fetchImpl })
  const api = {
    ...client,
    listDiscussion: vi.fn(async () => ({ messages: initial })),
    sendDiscussion: vi.fn(client.sendDiscussion), runDiscussionMove: vi.fn(client.runDiscussionMove),
    getNode: vi.fn(async () => ({ node: { ...node, content_revision: 9 }, annotations: [], segments: [] })),
    promoteDiscussion: vi.fn(async (_id: string, body: { mode: 'child' | 'section'; messageIds: string[]; baseRevision?: number }) => ({
      node: { ...node, id: body.mode === 'child' ? 'child' : node.id, parent_id: body.mode === 'child' ? node.id : null, document_content: '沉淀正文', content_revision: 10 },
      content: { revision: 10 },
      messages: initial.map((item) => body.messageIds.includes(item.id) ? { ...item, promoted_mode: body.mode, promoted_node_id: body.mode === 'child' ? 'child' : node.id } : item),
    })),
  }
  const onSaved = vi.fn((saved: NodeRow) => useWorkbench.getState().upsertNode(saved))
  const view = render(<ApiProvider api={api as never}><DiscussionStrip key={node.id} node={node} onSaved={onSaved} /></ApiProvider>)
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: '讨论 (2)' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '讨论输入' })).toBeEnabled())
  }
  const emit = async (events: unknown[], end = false) => {
    await act(async () => {
      for (const event of events) source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      if (end) source.close()
    })
  }
  return { api, onSaved, view, open, emit, cancel, getSignal: () => signal }
}

describe('DiscussionStrip', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({ nodes: [node], rootNodeId: node.id, treeId: node.tree_id })
  })

  it('loads a collapsed count and toggles the discussion without losing it', async () => {
    const { open } = setup()
    expect(screen.queryByRole('textbox', { name: '讨论输入' })).not.toBeInTheDocument()
    await open()
    expect(screen.getByText('先验证关键假设。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '讨论 (2)' }))
    expect(screen.queryByText('先验证关键假设。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '讨论 (2)' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('streams a reply and gates sending, moves and promotion until done', async () => {
    const { api, open, emit, onSaved } = setup()
    await open()
    fireEvent.click(screen.getByRole('checkbox'))
    const input = screen.getByRole('textbox', { name: '讨论输入' })
    fireEvent.change(input, { target: { value: '继续讨论' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.sendDiscussion).toHaveBeenCalledOnce())
    expect(api.sendDiscussion).toHaveBeenCalledWith('note', '继续讨论', expect.anything(), expect.any(AbortSignal))
    expect(input).toBeDisabled()
    for (const name of ['反驳我', '三视角', '收敛', '转为子文档', '追加为小节']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    await emit([{ type: 'ping' }])
    expect(screen.getByRole('status')).toHaveTextContent('思考中 · 连接正常')
    await emit([{ type: 'chunk', text: '**先做' }, { type: 'chunk', text: '实验**' }])
    expect(screen.getByText('先做实验').tagName).toBe('STRONG')
    const saved = [...initial, message('u2', 'user', '继续讨论'), message('a2', 'assistant', '**先做实验**')]
    await emit([{ type: 'done', messages: saved }], true)
    expect(input).toBeEnabled()
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '讨论 (4)' })).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each([['反驳我', 'challenge'], ['三视角', 'perspectives'], ['收敛', 'converge']] as const)('runs %s directly with a synthetic user message', async (label, move) => {
    const { api, open, emit } = setup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(api.runDiscussionMove).toHaveBeenCalledWith('note', move, expect.anything(), expect.any(AbortSignal)))
    expect(within(screen.getByLabelText('讨论消息')).getByText(label)).toBeInTheDocument()
    const personas = move === 'perspectives' ? ['架构师', '保守派', '用户代言人'] : [label]
    const responses = personas.map((persona, index) => message(`a${index + 2}`, 'assistant', `${index ? '\n\n' : ''}### ${persona}\n\n观点 ${index + 1}`))
    for (const [index, response] of responses.entries()) await emit([{ type: 'chunk', text: response.content, step: index + 1, persona: personas[index] }])
    const chips = document.querySelectorAll('.discussion-persona')
    expect(Array.from(chips, (chip) => chip.textContent)).toEqual(personas.map((persona, index) => `${index + 1}. ${persona}`))
    await emit([{ type: 'done', messages: [...initial, message('u2', 'user', label), ...responses] }], true)
    if (move === 'perspectives') expect(document.querySelectorAll('.discussion-persona')).toHaveLength(3)
    expect(api.sendDiscussion).not.toHaveBeenCalled()
  })

  it('keeps completed and partial perspectives visible when the second step fails', async () => {
    const { open, emit } = setup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: '三视角' }))
    const first = message('first', 'assistant', '### 架构师\n\n第一步完成')
    await emit([{ type: 'chunk', text: first.content, step: 1, persona: '架构师' }, { type: 'chunk', text: '\n\n### 保守派\n\n第二步部分', step: 2, persona: '保守派' }])
    await emit([{ type: 'error', message: '模型错误', step: 2, persona: '保守派', messages: [...initial, first] }], true)
    expect(screen.getByRole('alert')).toHaveTextContent('第 2 步（保守派）：模型错误')
    expect(screen.getAllByText('第一步完成')).toHaveLength(1)
    expect(screen.getByText('第二步部分')).toBeInTheDocument()
    expect(screen.getByText('未完成 · 未保存')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('stops a pending stream and retains its unsaved partial reply', async () => {
    const { open, emit, cancel, getSignal } = setup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: '反驳我' }))
    await emit([{ type: 'chunk', text: '未完成回复' }])
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '讨论输入' })).toBeEnabled())
    expect(getSignal()?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('已停止')
    expect(screen.getByText('未完成回复')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('aborts the old discussion when its document unmounts', async () => {
    const { open, emit, view, getSignal, cancel, onSaved } = setup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: '反驳我' }))
    await emit([{ type: 'ping' }])
    view.unmount()
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(getSignal()?.aborted).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('does not submit IME confirmation or Shift+Enter', async () => {
    const { open, api, emit } = setup()
    await open()
    const input = screen.getByRole('textbox', { name: '讨论输入' })
    fireEvent.change(input, { target: { value: '中文输入' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(api.sendDiscussion).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.sendDiscussion).toHaveBeenCalledOnce())
    await emit([{ type: 'done', messages: initial }], true)
  })

  it.each(['child', 'section'] as const)('promotes selected messages as %s, refreshes nodes and shows the saved marker', async (mode) => {
    const { open, api, onSaved } = setup()
    await open()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByLabelText('沉淀讨论')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: mode === 'child' ? '转为子文档' : '追加为小节' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(api.promoteDiscussion).toHaveBeenCalledWith('note', { mode, messageIds: ['a1'], ...(mode === 'section' ? { baseRevision: 5 } : {}) })
    expect(screen.getByText(`已沉淀 → ${mode === 'child' ? '子文档' : '小节'}`)).toBeInTheDocument()
    expect(screen.queryByLabelText('沉淀讨论')).not.toBeInTheDocument()
    expect(useWorkbench.getState().nodesById[mode === 'child' ? 'child' : 'note'].document_content).toBe('沉淀正文')
    expect(useWorkbench.getState().toast).toBe(mode === 'child' ? '已转为子文档' : '已追加为小节，可在版本历史中回退')
  })

  it('reloads the current document and retries a section conflict exactly once', async () => {
    const { open, api, onSaved } = setup()
    api.promoteDiscussion.mockRejectedValueOnce(new ApiError(409, { currentRevision: 8 }))
    await open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '追加为小节' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
    expect(api.getNode).toHaveBeenCalledOnce()
    expect(api.promoteDiscussion).toHaveBeenNthCalledWith(1, 'note', { mode: 'section', messageIds: ['a1'], baseRevision: 5 })
    expect(api.promoteDiscussion).toHaveBeenNthCalledWith(2, 'note', { mode: 'section', messageIds: ['a1'], baseRevision: 9 })
    expect(useWorkbench.getState().nodesById.note.content_revision).toBe(10)
  })

  it('stops after a second section conflict and keeps the selection for retry', async () => {
    const { open, api } = setup()
    api.promoteDiscussion.mockRejectedValue(new ApiError(409, { currentRevision: 10 }))
    await open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '追加为小节' }))
    await waitFor(() => expect(useWorkbench.getState().toast).toBe('内容已变化，请重试'))
    expect(api.promoteDiscussion).toHaveBeenCalledTimes(2)
    expect(api.getNode).toHaveBeenCalledOnce()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('内容已变化，请重试')
  })
})
