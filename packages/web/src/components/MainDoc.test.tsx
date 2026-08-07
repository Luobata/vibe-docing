import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { MainDoc } from './MainDoc'

function node(id: string, parentId: string | null): NodeRow {
  return {
    ai_response: JSON.stringify({ content: [{ content: [{ text: '讲了 Redis 和内存', type: 'text' }], type: 'paragraph' }], type: 'doc' }),
    created_at: '', id, is_deleted: 0, model_override: null, parent_id: parentId,
    sort_order: 0, status: 'complete', tree_id: 't', updated_at: '', user_input: 'Q',
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
    const range = document.createRange()
    range.selectNodeContents(view)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.mouseUp(view)
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))

    await waitFor(() => {
      expect(api.fork).toHaveBeenCalledWith('root', expect.objectContaining({
        kind: 'selection', seedText: '深入', treeId: 't',
      }))
      expect(useWorkbench.getState().subdocTabs).toContain('child')
    })
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
    const range = document.createRange()
    range.selectNodeContents(view)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.mouseUp(view)
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))

    await waitFor(() => {
      expect(streamAnswer).toHaveBeenCalledWith('child', '深入', expect.anything())
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
    await waitFor(() => expect(api.streamAnswer).toHaveBeenCalledWith('root', '第一个问题', expect.anything()))
    expect(api.fork).not.toHaveBeenCalled()
    await waitFor(() => expect(useWorkbench.getState().nodesById['root']?.user_input).toBe('第一个问题'))
    expect(useWorkbench.getState().nodesById['root']?.status).toBe('complete')
    // no separate transcript turn for the first question
    expect(screen.queryByTestId('turn-question')).toBeNull()
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
    await waitFor(() => expect(api.streamAnswer).toHaveBeenNthCalledWith(1, 'root', '第一个问题', expect.anything()))

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '追问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // now that root has an answer, the follow-up forks from root
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(1, 'root', expect.objectContaining({ kind: 'whole', seedText: '追问' })))
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
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(1, 'root', expect.objectContaining({ kind: 'whole', seedText: '第一问' })))

    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '第二问' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // second turn forks from the FIRST answer node, not from root
    await waitFor(() => expect(api.fork).toHaveBeenNthCalledWith(2, 'answer1', expect.objectContaining({ kind: 'whole', seedText: '第二问' })))
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

  it('stops streaming on demand and re-enables input', async () => {
    const root = node('root', null)
    const answer = { ...node('answer', 'root'), user_input: 'Q' }
    const api = {
      editNode: vi.fn(async () => ({ node: { ...answer, status: 'draft' as const } })),
      fork: vi.fn(async () => ({ annotation: { id: 'a' }, childNode: answer })),
      getNode: vi.fn(() => new Promise(() => {})),
      // never calls onDone → stays streaming until stopped
      streamAnswer: vi.fn(async (_id: string, _q: string, handlers: { onChunk(t: string): void }) => {
        handlers.onChunk('片段')
        await new Promise<void>(() => {})
      }),
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><MainDoc /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    await waitFor(() => expect(screen.queryByTestId('assistant-status')).toBeNull())
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
    await waitFor(() => expect(streamAnswer).toHaveBeenNthCalledWith(2, 'answer', '会失败的问题', expect.anything()))
  })
})
