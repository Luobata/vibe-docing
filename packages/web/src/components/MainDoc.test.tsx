import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import type { RouteCandidate, RouteConvergence } from '../api/types'
import { useWorkbench } from '../state/workbench-store'
import { MainDoc } from './MainDoc'

function node(id: string, parentId: string | null): NodeRow {
  return {
    ai_response: JSON.stringify({ content: [{ content: [{ text: '讲了 Redis 和内存', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
    created_at: '', id, is_deleted: 0, model_override: null, parent_id: parentId,
    sort_order: 0, status: 'complete', tree_id: 't', updated_at: '', user_input: 'Q',
  }
}

function pasteImage(target: HTMLElement, name = 'shot.png'): void {
  fireEvent.paste(target, {
    clipboardData: {
      files: [new File(['x'], name, { type: 'image/png' })],
      items: [],
    },
  })
}

const mainRoute: RouteCandidate = {
  label: '主文档',
  refId: null,
  score: 1,
  target: 'main-continuation',
}

function convergence(
  state: RouteConvergence['state'],
  candidates: RouteCandidate[] = [],
  chosen?: RouteCandidate,
): RouteConvergence {
  return {
    candidates,
    chosen,
    fallback: mainRoute,
    state,
    thresholds: { highConfidence: 0.7, leadMargin: 0.2 },
  }
}

describe('MainDoc fork flow', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('guides the user how to start when no node is selected', () => {
    render(<ApiProvider api={{} as never}><MainDoc /></ApiProvider>)
    const empty = screen.getByTestId('main-doc-empty')
    expect(empty).toHaveTextContent('左上角')
    expect(empty).toHaveTextContent('新建')
    expect(empty).toHaveTextContent('对话')
  })

  it('puts the conversation in a scroll region above the composer', () => {
    const root = node('root', null)
    const api = { getNode: vi.fn(() => new Promise(() => {})) }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)
    const scroll = screen.getByTestId('conversation-scroll')
    const chat = screen.getByLabelText('chat-input')
    // ChatBox lives in the composer, which is a sibling *after* the scroll region.
    expect(scroll).toBeInTheDocument()
    expect(scroll.contains(chat)).toBe(false)
    expect(scroll.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows parent context for a derived document and can return to its source', async () => {
    const root = { ...node('root', null), user_input: 'Memory 架构' }
    const child = { ...node('child', 'root'), user_input: 'MemoryScope 结论' }
    const source = {
      anchor_from: 0, anchor_to: 11, child_node_id: 'child', created_at: '', id: 'ann-source',
      kind: 'selection', node_id: 'root', note: null, quoted_text: 'MemoryScope 增加 roleId',
    }
    const api = {
      getNode: vi.fn(async (id: string) => id === 'child'
        ? { annotations: [], node: child, segments: [] }
        : { annotations: [source], node: root, segments: [] }),
    }
    useWorkbench.getState().loadTree({ nodes: [root, child], rootNodeId: 'root', treeId: 't' })
    useWorkbench.getState().setMain('child')
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const context = await screen.findByLabelText('派生来源')
    expect(context).toHaveTextContent('Memory 架构')
    expect(context).toHaveTextContent('MemoryScope 增加 roleId')
    fireEvent.click(within(context).getByRole('button', { name: '返回来源' }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    expect(useWorkbench.getState().focusedAnnotationId).toBe('ann-source')
    expect(useWorkbench.getState().subdocPanelTab).toBe('derivations')
    expect(useWorkbench.getState().activeSubdocId).toBe('child')
    expect(useWorkbench.getState().anchoredSubdocId).toBe('child')
  })

  it('falls back to the child annotation seed when the parent link annotation is unavailable', async () => {
    const root = { ...node('root', null), user_input: 'Memory 架构' }
    const child = { ...node('child', 'root'), user_input: 'MemoryScope 结论' }
    const api = {
      getNode: vi.fn(async (id: string) => id === 'child'
        ? {
            annotations: [],
            node: child,
            segments: [{
              content: 'MemoryScope 增加 roleId', id: 'seed', node_id: 'child', ref_node_id: 'root',
              ref_version_no: null, seq: 0, type: 'annotation-seed',
            }],
          }
        : { annotations: [], node: root, segments: [] }),
    }
    useWorkbench.getState().loadTree({ nodes: [root, child], rootNodeId: 'root', treeId: 't' })
    useWorkbench.getState().setMain('child')
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    expect(await screen.findByLabelText('派生来源')).toHaveTextContent('MemoryScope 增加 roleId')
  })

  it('forks the selected text and opens the returned child tab', async () => {
    const root = node('root', null)
    const child = { ...node('child', 'root'), user_input: '深入' }
    const api = {
      fork: vi.fn(async () => ({ annotation: { id: 'ann1' }, childNode: child })),
      getNode: vi.fn(async () => ({ annotations: [], node: root, segments: [] })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const view = screen.getByTestId('doc-view')
    const body = view.querySelector('.doc-body')!
    const range = document.createRange()
    range.selectNodeContents(body)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.contextMenu(body)
    fireEvent.click(screen.getByRole('menuitem', { name: '就此展开' }))
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))

    await waitFor(() => {
      expect(api.fork).toHaveBeenCalledWith('root', expect.objectContaining({
        kind: 'selection', seedText: '深入', treeId: 't',
      }), expect.any(AbortSignal))
      expect(useWorkbench.getState().subdocTabs).toContain('child')
    })
  })

  it('keeps fork text and image when creating the branch rejects', async () => {
    const root = node('root', null)
    const api = {
      fork: vi.fn().mockRejectedValue(new Error('network failed')),
      getNode: vi.fn(() => new Promise(() => {})),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const body = screen.getByTestId('doc-view').querySelector('.doc-body')!
    const range = document.createRange()
    range.selectNodeContents(body)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.contextMenu(body)
    fireEvent.click(screen.getByRole('menuitem', { name: '就此展开' }))

    const input = screen.getByLabelText('fork-question')
    fireEvent.change(input, { target: { value: '失败后继续编辑' } })
    pasteImage(input, 'fork.png')
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))

    await screen.findByText('提交失败，文字和图片均已保留。')
    expect(api.fork).toHaveBeenCalledOnce()
    expect(input).toHaveValue('失败后继续编辑')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
  })

  it('answers the forked child so it is not left empty (design §4③ step 4)', async () => {
    const root = node('root', null)
    const child = { ...node('child', 'root'), ai_response: null, status: 'draft' as const, user_input: null }
    const streamAnswer = vi.fn(async (_id: string, _question: string, handlers: {
      onChunk(text: string): void
      onDone(result: NodeRow): void
    }) => {
      handlers.onChunk('答案')
      handlers.onDone({
        ...child,
        ai_response: JSON.stringify({ content: [{ content: [{ text: '答案', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
        status: 'complete',
        user_input: '深入',
      })
    })
    const api = {
      fork: vi.fn(async () => ({ annotation: { id: 'ann1' }, childNode: child })),
      getNode: vi.fn(async () => ({ annotations: [], node: root, segments: [] })),
      route: vi.fn(async () => ({
        candidates: [],
        fallback: { label: '主文档', refId: null, score: 1, target: 'main-continuation' },
        state: 'consistent',
        thresholds: { highConfidence: 0.7, leadMargin: 0.2 },
      })),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const view = screen.getByTestId('doc-view')
    const body = view.querySelector('.doc-body')!
    const range = document.createRange()
    range.selectNodeContents(body)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.contextMenu(body)
    fireEvent.click(screen.getByRole('menuitem', { name: '就此展开' }))
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))

    await waitFor(() => {
      expect(streamAnswer).toHaveBeenCalledWith('child', '深入', expect.anything(), expect.any(AbortSignal))
    })
    await waitFor(() => {
      expect(useWorkbench.getState().nodesById['child']?.status).toBe('complete')
    })
  })

  it('answers the empty root node directly instead of forking an empty root', async () => {
    const root = { ...node('root', null), ai_response: null, status: 'complete' as const, user_input: null }
    const api = {
      editNode: vi.fn(async () => ({ node: { ...root, status: 'draft' as const, user_input: '第一个问题' } })),
      fork: vi.fn(async () => ({ annotation: { id: 'x' }, childNode: node('child', 'root') })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer: vi.fn(async (_id: string, _q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void }) => {
        handlers.onChunk('根答案')
        handlers.onDone({ ...root, ai_response: JSON.stringify({ content: [{ content: [{ text: '根答案', type: 'text' }], type: 'paragraph' }], type: 'doc' }), status: 'complete', user_input: '第一个问题' })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第一个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    // first question fills the ROOT node itself — no fork, no empty root left behind
    await waitFor(() => expect(api.streamAnswer).toHaveBeenCalledWith('root', '第一个问题', expect.anything(), expect.any(AbortSignal)))
    expect(api.fork).not.toHaveBeenCalled()
    await waitFor(() => expect(useWorkbench.getState().nodesById['root']?.user_input).toBe('第一个问题'))
    expect(useWorkbench.getState().nodesById['root']?.status).toBe('complete')
    // no separate transcript turn for the first question
    expect(screen.queryByTestId('turn-question')).toBeNull()
  })

  it('returns chat submission failures to the composer and clears only after retry succeeds', async () => {
    const root = node('root', null)
    const firstAnswer = { ...node('answer-1', 'root'), user_input: '失败也别丢' }
    const secondAnswer = { ...node('answer-2', 'answer-1'), user_input: '失败也别丢' }
    let forkCount = 0
    const streamAnswer = vi.fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockImplementationOnce(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...secondAnswer, status: 'complete' }))
    const api = {
      editNode: vi.fn(async (id: string) => ({
        node: { ...(id === firstAnswer.id ? firstAnswer : secondAnswer), status: 'draft' as const },
      })),
      fork: vi.fn(async () => {
        forkCount += 1
        return {
          annotation: { id: `whole-ann-${forkCount}` },
          childNode: forkCount === 1 ? firstAnswer : secondAnswer,
        }
      }),
      getNode: vi.fn(() => new Promise(() => {})),
      route: vi.fn(async () => convergence('consistent', [mainRoute], mainRoute)),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    const input = screen.getByLabelText('chat-input')
    fireEvent.change(input, { target: { value: '失败也别丢' } })
    pasteImage(input)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))

    await screen.findByText('提交失败，文字和图片均已保留，请重试。')
    expect(input).toHaveValue('失败也别丢')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId('chat-image-thumb')).toBeNull())
    expect(input).toHaveValue('')
  })

  it('forks a follow-up after the root already has an answer', async () => {
    const root = { ...node('root', null), ai_response: null, status: 'complete' as const, user_input: null }
    const answered = { ...root, ai_response: JSON.stringify({ content: [{ content: [{ text: '根答案', type: 'text' }], type: 'paragraph' }], type: 'doc' }), user_input: '第一个问题' }
    const child = { ...node('child', 'root'), user_input: '追问' }
    const api = {
      editNode: vi.fn(async (id: string) => ({ node: { ...(id === 'root' ? answered : child), status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'x' }, childNode: child })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer: vi.fn(async (id: string, _q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void }) => {
        handlers.onChunk('x')
        handlers.onDone({ ...(id === 'root' ? answered : child), status: 'complete' })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第一个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.streamAnswer).toHaveBeenNthCalledWith(1, 'root', '第一个问题', expect.anything(), expect.any(AbortSignal)))

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '追问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // now that root has an answer, the follow-up forks from root
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(1, 'root', expect.objectContaining({ kind: 'whole', seedText: '追问' }), expect.any(AbortSignal)))
  })

  it('streams an answer in place without opening a subdoc tab or promoting', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '持久化怎么配？' }
    const streamAnswer = vi.fn(async (_id: string, _question: string, handlers: {
      onChunk(text: string): void
      onDone(result: NodeRow): void
    }) => {
      handlers.onChunk('回答')
      handlers.onDone({ ...answer, ai_response: JSON.stringify({ content: [{ content: [{ text: '回答', type: 'text' }], type: 'paragraph' }], type: 'doc' }), status: 'complete' })
    })
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      route: vi.fn(async () => convergence('consistent', [mainRoute], mainRoute)),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '持久化怎么配？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    // the question shows in place, paired with the answer, in the conversation region
    expect(await screen.findByTestId('turn-question')).toHaveTextContent('持久化怎么配？')
    expect(await screen.findByText('回答')).toBeInTheDocument()
    // linear: no promotion, no subdoc tab, no routing/migration UI
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    expect(useWorkbench.getState().activeSubdocId).toBeNull()
    expect(useWorkbench.getState().subdocTabs).not.toContain('answer')
    expect(screen.queryByRole('button', { name: '搬过去' })).toBeNull()
    expect(screen.queryByRole('button', { name: '查看迁移位置' })).toBeNull()
  })

  it('runs answer and route in parallel, but waits for answer done before showing RoutePrompt', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '缓存怎么分层？' }
    const candidate: RouteCandidate = {
      label: '缓存细节',
      refId: 'ann-cache',
      score: 0.91,
      target: 'new-branch',
    }
    let finishAnswer!: () => void
    const answerGate = new Promise<void>((resolve) => { finishAnswer = resolve })
    const streamAnswer = vi.fn(async (_id: string, _question: string, handlers: {
      onChunk(text: string): void
      onDone(result: NodeRow): void
    }) => {
      handlers.onChunk('回答片段')
      await answerGate
      handlers.onDone({ ...answer, status: 'complete' })
    })
    const route = vi.fn(async () =>
      convergence('high-confidence-elsewhere', [candidate], candidate),
    )
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      route,
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '缓存怎么分层？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(streamAnswer).toHaveBeenCalledWith(
        'answer',
        '缓存怎么分层？',
        expect.anything(),
        expect.any(AbortSignal),
      )
      expect(route).toHaveBeenCalledWith('answer')
    })
    expect(screen.queryByRole('button', { name: '搬过去' })).toBeNull()

    await act(async () => finishAnswer())
    expect(await screen.findByRole('button', { name: '搬过去' })).toBeInTheDocument()
    expect(useWorkbench.getState().routeByNodeId.answer).toEqual(
      convergence('high-confidence-elsewhere', [candidate], candidate),
    )
  })

  it('does not render RoutePrompt when decideRouteUi keeps the answer in place', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '继续' }
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      route: vi.fn(async () => convergence('consistent', [mainRoute], mainRoute)),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...answer, status: 'complete' })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(api.route).toHaveBeenCalledWith('answer'))
    await waitFor(() => expect(screen.getByLabelText('chat-input')).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: '搬过去' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '选择回答落点' })).toBeNull()
  })

  it('accepts a route candidate, migrates the answer, and refreshes subdocTabs', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '缓存怎么分层？' }
    const candidate: RouteCandidate = {
      label: '缓存细节',
      refId: 'ann-cache',
      score: 0.91,
      target: 'new-branch',
    }
    const moved = { ...answer, parent_id: 'root', sort_order: 1 }
    const migrate = vi.fn(async () => ({ node: moved, path: [root, moved] }))
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      migrate,
      route: vi.fn(async () => convergence('high-confidence-elsewhere', [candidate], candidate)),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...answer, status: 'complete' })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '缓存怎么分层？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(await screen.findByRole('button', { name: '搬过去' }))

    await waitFor(() => expect(migrate).toHaveBeenCalledWith('answer', {
      newParentId: 'root',
      seedText: '缓存怎么分层？',
      target: 'new-branch',
    }))
    await waitFor(() => expect(useWorkbench.getState().subdocTabs).toContain('answer'))
    expect(screen.queryByRole('button', { name: '搬过去' })).toBeNull()
  })

  it('dismisses a route suggestion without migrating or changing subdocTabs', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '继续' }
    const candidate: RouteCandidate = {
      label: '缓存细节',
      refId: 'ann-cache',
      score: 0.91,
      target: 'new-branch',
    }
    const migrate = vi.fn()
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      migrate,
      route: vi.fn(async () => convergence('high-confidence-elsewhere', [candidate], candidate)),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...answer, status: 'complete' })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.click(await screen.findByRole('button', { name: '留下' }))

    expect(migrate).not.toHaveBeenCalled()
    expect(useWorkbench.getState().subdocTabs).not.toContain('answer')
    expect(screen.queryByRole('button', { name: '留下' })).toBeNull()
  })

  it('shows a dismissible routing failure without interrupting the completed answer', async () => {
    const root = node('root', null)
    const answer = {
      ...node('answer', 'root'),
      ai_response: JSON.stringify({ content: [{ content: [{ text: '回答仍然显示', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
      user_input: '继续',
    }
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      route: vi.fn(async () => { throw new Error('router unavailable') }),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...answer, status: 'complete' })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('回答仍然显示')).toBeInTheDocument()
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('router unavailable')
    expect(notice).toHaveTextContent('回答已保留')
    expect(screen.getByLabelText('chat-input')).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '关闭路由失败提示' }))
    expect(screen.queryByText(/router unavailable/)).toBeNull()
    expect(screen.getByText('回答仍然显示')).toBeInTheDocument()
  })

  it('edits a transcript turn question by its id and regenerates that turn', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '持久化怎么配？' }
    const streamAnswer = vi.fn(async (_id: string, _question: string, handlers: {
      onChunk(text: string): void
      onDone(result: NodeRow): void
    }) => {
      handlers.onChunk('回答')
      handlers.onDone({ ...answer, ai_response: JSON.stringify({ content: [{ content: [{ text: '回答', type: 'text' }], type: 'paragraph' }], type: 'doc' }), status: 'complete' })
    })
    const editNode = vi.fn(async (_id: string, body: { userInput: string }) => ({ node: { ...answer, status: 'draft' as const, user_input: body.userInput } }))
    const api = {
      editNode,
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    // drive one transcript turn into existence
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '持久化怎么配？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByTestId('turn-question')).toHaveTextContent('持久化怎么配？')
    await waitFor(() => expect(screen.getByLabelText('chat-input')).not.toBeDisabled())
    streamAnswer.mockClear()
    editNode.mockClear()

    // edit the turn's question in place and save → regenerate that turn
    const turn = screen.getByRole('region', { name: '对话轮次' })
    fireEvent.click(within(turn).getByLabelText('编辑问题'))
    fireEvent.change(within(turn).getByLabelText('edit-question'), { target: { value: '改后的轮次问题' } })
    fireEvent.click(within(turn).getByRole('button', { name: '保存并重新生成' }))

    // editNode targets the TURN id (not the last-only), then the turn regenerates
    await waitFor(() => expect(editNode).toHaveBeenCalledWith('answer', { userInput: '改后的轮次问题' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenCalledWith('answer', '改后的轮次问题', expect.anything(), expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByTestId('turn-question')).toHaveTextContent('改后的轮次问题'))
  })

  it('keeps a transcript edit and image when regeneration rejects', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '原轮次问题' }
    const editNode = vi.fn()
      .mockResolvedValueOnce({ node: { ...answer, status: 'draft' as const } })
      .mockRejectedValueOnce(new Error('network failed'))
    const api = {
      editNode,
      fork: vi.fn(async () => ({ annotation: { id: 'whole-ann' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      route: vi.fn(async () => convergence('consistent', [mainRoute], mainRoute)),
      streamAnswer: vi.fn(async (_id: string, _question: string, handlers: {
        onDone(result: NodeRow): void
      }) => handlers.onDone({ ...answer, status: 'complete' })),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '原轮次问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    const turn = await screen.findByRole('region', { name: '对话轮次' })
    await waitFor(() => expect(screen.getByLabelText('chat-input')).not.toBeDisabled())

    fireEvent.click(within(turn).getByLabelText('编辑问题'))
    const editor = within(turn).getByLabelText('edit-question')
    fireEvent.change(editor, { target: { value: '保留这个修改' } })
    pasteImage(editor, 'turn.png')
    fireEvent.click(within(turn).getByRole('button', { name: '保存并重新生成' }))
    fireEvent.click(within(turn).getByRole('button', { name: '仅提交文字' }))

    await screen.findByText('重新生成失败，文字和图片均已保留。')
    expect(editNode).toHaveBeenLastCalledWith('answer', { userInput: '保留这个修改' })
    expect(editor).toHaveValue('保留这个修改')
    expect(within(turn).getByTestId('chat-image-thumb')).toBeInTheDocument()
  })

  it('editing a NON-last turn keeps lastQuestion coupled to the last turn (retry uses the last question)', async () => {
    const root = node('root', null)
    const a1 = { ...node('answer1', 'root'), user_input: '第一问' }
    const a2 = { ...node('answer2', 'answer1'), user_input: '第二问' }
    let forkCount = 0
    let secondTurnErrored = false
    const streamAnswer = vi.fn(async (id: string, q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void; onError(m: string): void }) => {
      // The last turn's first stream errors so its DocView exposes a retry button.
      if (id === 'answer2' && q === '第二问' && !secondTurnErrored) { secondTurnErrored = true; handlers.onError('HTTP 500'); return }
      handlers.onChunk('x')
      handlers.onDone({ ...(id === 'answer1' ? a1 : a2), status: 'complete', user_input: q })
    })
    const api = {
      editNode: vi.fn(async (id: string, body: { userInput: string }) => ({ node: { ...(id === 'answer1' ? a1 : a2), status: 'draft' as const, user_input: body.userInput } })),
      fork: vi.fn(async () => { forkCount += 1; return { annotation: { id: `ann${forkCount}` }, childNode: forkCount === 1 ? a1 : a2 } }),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    // build two turns
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第一问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(1, 'root', expect.objectContaining({ seedText: '第一问' }), expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByLabelText('chat-input')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第二问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(2, 'answer1', expect.objectContaining({ seedText: '第二问' }), expect.any(AbortSignal)))
    // last turn errored → its retry button is present
    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument())

    // edit the FIRST (non-last) turn's question
    const firstTurn = screen.getAllByRole('region', { name: '对话轮次' })[0]
    fireEvent.click(within(firstTurn).getByLabelText('编辑问题'))
    fireEvent.change(within(firstTurn).getByLabelText('edit-question'), { target: { value: '改后的第一问' } })
    fireEvent.click(within(firstTurn).getByRole('button', { name: '保存并重新生成' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenCalledWith('answer1', '改后的第一问', expect.anything(), expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByLabelText('chat-input')).not.toBeDisabled())

    // retry the last turn: it must regenerate answer2 with the LAST question (第二问),
    // NOT the non-last turn's edited question — lastQuestion stayed coupled to the last turn.
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenLastCalledWith('answer2', '第二问', expect.anything(), expect.any(AbortSignal)))
  })

  it('chains follow-up turns by forking from the previous answer node', async () => {
    const root = node('root', null)
    const a1 = { ...node('answer1', 'root'), user_input: '第一问' }
    const a2 = { ...node('answer2', 'answer1'), user_input: '第二问' }
    let forkCount = 0
    const api = {
      editNode: vi.fn(async (id: string) => ({ node: { ...(id === 'answer1' ? a1 : a2), status: 'draft' as const } })),
      fork: vi.fn(async () => {
        forkCount += 1
        return { annotation: { id: `ann${forkCount}` }, childNode: forkCount === 1 ? a1 : a2 }
      }),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer: vi.fn(async (_id: string, _q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void }) => {
        handlers.onChunk('x')
        handlers.onDone({ ...(forkCount === 1 ? a1 : a2), status: 'complete' })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第一问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(1, 'root', expect.objectContaining({ kind: 'whole', seedText: '第一问' }), expect.any(AbortSignal)))

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第二问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // second turn forks from the FIRST answer node, not from root
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(2, 'answer1', expect.objectContaining({ kind: 'whole', seedText: '第二问' }), expect.any(AbortSignal)))
  })

  it('surfaces thinking then replying status, and clears it when done', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: 'Q' }
    let resolveDone: (() => void) | null = null
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'a' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer: vi.fn(async (_id: string, _q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void }) => {
        handlers.onChunk('片段')
        await new Promise<void>((resolve) => { resolveDone = () => { handlers.onDone({ ...answer, status: 'complete' }); resolve() } })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    // after the first chunk the status reads "replying"
    await waitFor(() => expect(screen.getByTestId('assistant-status')).toHaveTextContent('回复'))
    await act(async () => { resolveDone?.() })
    await waitFor(() => expect(screen.queryByTestId('assistant-status')).toBeNull())
  })

  it('aborts streaming, transitions cancelling to cancelled, and ignores late events', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: 'Q' }
    let receivedSignal: AbortSignal | undefined
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'a' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer: vi.fn(async (_id: string, _q: string, handlers: {
        onCancelled?(): void
        onChunk(t: string): void
        onDone(n: NodeRow): void
      }, signal?: AbortSignal) => {
        receivedSignal = signal
        handlers.onChunk('片段')
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => {
            setTimeout(() => {
              handlers.onCancelled?.()
              handlers.onChunk('不应追加')
              handlers.onDone({ ...answer, status: 'complete' })
              resolve()
            }, 0)
          }, { once: true })
        })
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(receivedSignal?.aborted).toBe(true)
    expect(screen.getByTestId('assistant-status')).toHaveTextContent('正在停止生成')
    await waitFor(() => expect(screen.getByText('已停止生成')).toBeInTheDocument())
    expect(screen.queryByTestId('assistant-status')).toBeNull()
    const views = screen.getAllByTestId('doc-view')
    const cancelledView = views[views.length - 1]
    expect(cancelledView).toHaveTextContent('片段')
    expect(cancelledView).not.toHaveTextContent('不应追加')
    expect(screen.getByLabelText('chat-input')).not.toBeDisabled()
  })

  it('humanizes stream errors, keeps input usable, and retries the same turn', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: '会失败的问题' }
    let call = 0
    const streamAnswer = vi.fn(async (_id: string, _q: string, handlers: { onChunk(t: string): void; onDone(n: NodeRow): void; onError(m: string): void }) => {
      call += 1
      if (call === 1) { handlers.onError('HTTP 500'); return }
      handlers.onChunk('好了'); handlers.onDone({ ...answer, status: 'complete' })
    })
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'a' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '会失败的问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('HTTP 500')
    expect(alert.textContent && alert.textContent.length > 0).toBe(true)
    expect(screen.getByLabelText('chat-input')).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    // retry re-runs streamAnswer against the SAME answer node with the SAME question
    await waitFor(() => expect(streamAnswer).toHaveBeenNthCalledWith(2, 'answer', '会失败的问题', expect.anything(), expect.any(AbortSignal)))
  })

  it('edits the main question and regenerates', async () => {
    const editNode = vi.fn(async (_id: string, body: { userInput: string }) => ({ node: { ...node('root', null), user_input: body.userInput } }))
    const streamAnswer = vi.fn(async (_id: string, _q: string, h: { onChunk(t: string): void; onDone(n: NodeRow): void }) => {
      h.onChunk('新答案')
      h.onDone({ ...node('root', null), status: 'complete' })
    })
    useWorkbench.getState().loadTree({ nodes: [node('root', null)], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={{ getNode: async () => ({ node: node('root', null), annotations: [], segments: [] }), editNode, streamAnswer } as never}><MainDoc /></ApiProvider>)
    await waitFor(() => screen.getByLabelText('编辑问题'))
    fireEvent.click(screen.getByLabelText('编辑问题'))
    fireEvent.change(screen.getByLabelText('edit-question'), { target: { value: '改后的主问题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重新生成' }))
    await waitFor(() => expect(editNode).toHaveBeenCalledWith('root', { userInput: '改后的主问题' }))
    expect(streamAnswer).toHaveBeenCalled()
  })

  it('keeps the main question edit and image when regeneration rejects', async () => {
    const root = node('root', null)
    const api = {
      editNode: vi.fn().mockRejectedValue(new Error('network failed')),
      getNode: vi.fn(() => new Promise(() => {})),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)

    fireEvent.click(screen.getByLabelText('编辑问题'))
    const editor = screen.getByLabelText('edit-question')
    fireEvent.change(editor, { target: { value: '主问题修改要保留' } })
    pasteImage(editor, 'main-question.png')
    fireEvent.click(screen.getByRole('button', { name: '保存并重新生成' }))
    fireEvent.click(screen.getByRole('button', { name: '仅提交文字' }))

    await screen.findByText('重新生成失败，文字和图片均已保留。')
    expect(editor).toHaveValue('主问题修改要保留')
    expect(screen.getByTestId('chat-image-thumb')).toBeInTheDocument()
  })
})
