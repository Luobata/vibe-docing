import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { generationTaskKeys, generationTaskRegistry, useWorkbench } from '../state/workbench-store'
import { SelectionMenu } from './SelectionMenu'
import { Workbench } from './Workbench'

const workbenchCss = readFileSync(new URL(['.', 'Workbench.css'].join('/'), import.meta.url), 'utf8')

function node(id: string, parentId: string | null): NodeRow {
  return {
    ai_response: null,
    created_at: '',
    id,
    is_deleted: 0,
    model_override: null,
    parent_id: parentId,
    sort_order: 0,
    status: 'complete',
    tree_id: 't',
    updated_at: '',
    user_input: id,
  }
}

function selectText(body: Element, text: string): { from: number; to: number } {
  const textNode = body.querySelector('p')?.firstChild
  if (!textNode?.textContent) throw new Error('document paragraph text is missing')
  const from = textNode.textContent.indexOf(text)
  if (from < 0) throw new Error(`selection text not found: ${text}`)
  const range = document.createRange()
  range.setStart(textNode, from)
  range.setEnd(textNode, from + text.length)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  fireEvent.contextMenu(body)
  return { from, to: from + text.length }
}

function expectCssDeclarations(selector: string, declarations: Record<string, string>): void {
  const start = workbenchCss.indexOf(`${selector} {`)
  const end = workbenchCss.indexOf('}', start)
  expect(start, `missing CSS rule: ${selector}`).toBeGreaterThanOrEqual(0)
  const rule = workbenchCss.slice(start, end + 1)
  for (const [property, value] of Object.entries(declarations)) {
    expect(rule).toMatch(new RegExp(`${property}\\s*:\\s*${value}`))
  }
}

function expectDeclaredHitArea(element: HTMLElement, selector: string): void {
  expect(element.matches(selector)).toBe(true)
  expectCssDeclarations(selector, { 'min-height': '44px', 'min-width': '44px' })
}

describe('Workbench', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), node('child', 'root'), node('leaf', 'child')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })

  it('focus mode collapses both side panels via class while the main doc stays visible', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    const scroll = screen.getByTestId('conversation-scroll')
    scroll.scrollTop = 480
    fireEvent.click(screen.getByRole('button', { name: '进入沉浸聚焦' }))

    expect(scroll.scrollTop).toBe(0)
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-focus', 'true')
    expect(screen.getByTestId('tree-panel')).toHaveClass('is-collapsed')
    expect(screen.getByTestId('subdoc-panel')).toHaveClass('is-collapsed')
    expect(screen.getByTestId('main-doc')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('tree-panel')).not.toHaveClass('is-collapsed')
    expect(screen.getByTestId('subdoc-panel')).not.toHaveClass('is-collapsed')
  })

  it('uses the notebook title for the root instead of exposing the full generation prompt', () => {
    const root = { ...node('root', null), user_input: '这是一段很长的生成提示，不应该充当工作台标题' }
    act(() => useWorkbench.getState().loadTree({
      nodes: [root],
      rootNodeId: root.id,
      treeId: 'named-tree',
      treeTitle: '产品研究笔记',
    }))
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    expect(screen.getByRole('heading', { name: '产品研究笔记' })).toBeInTheDocument()
    expect(document.getElementById('main-document-question')).toHaveTextContent('产品研究笔记')
    expect(screen.getAllByRole('button', { name: '产品研究笔记' }).length).toBeGreaterThan(0)
  })

  it('focus mode hides side panels via class (animatable), not hidden attribute', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: /沉浸聚焦/ }))

    const tree = screen.getByTestId('tree-panel')
    expect(tree.hasAttribute('hidden')).toBe(false)
    expect(tree.className).toMatch(/is-collapsed/)
    expect(tree).toHaveAttribute('aria-hidden', 'true')
  })

  it('scrolls column roles when the active child is promoted', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    expect(screen.getByTestId('main-doc')).toHaveTextContent('root')
    const scroll = screen.getByTestId('conversation-scroll')
    scroll.scrollTop = 360
    fireEvent.click(screen.getByLabelText('设为主文档'))

    expect(scroll.scrollTop).toBe(0)
    expect(screen.getByTestId('main-doc')).toHaveTextContent('child')
    expect(screen.getByTestId('subdoc-panel')).toHaveTextContent('leaf')
    expect(useWorkbench.getState().mainPath).toEqual(['root', 'child'])
  })

  it('switches the mobile tablist without unmounting any panel', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const tabs = within(screen.getByRole('tablist', { name: '工作区面板' }))
    const tree = screen.getByTestId('tree-panel')
    const main = screen.getByTestId('main-doc')
    const subdoc = screen.getByTestId('subdoc-panel')

    fireEvent.click(tabs.getByRole('tab', { name: '笔记库' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'tree')
    fireEvent.click(tabs.getByRole('tab', { name: '关联' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'subdoc')
    expect(screen.getByTestId('tree-panel')).toBe(tree)
    expect(screen.getByTestId('main-doc')).toBe(main)
    expect(screen.getByTestId('subdoc-panel')).toBe(subdoc)
  })

  it('switches and focuses mobile tabs with horizontal arrow keys', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const tabs = within(screen.getByRole('tablist', { name: '工作区面板' }))
    const documentTab = tabs.getByRole('tab', { name: '文档' })
    documentTab.focus()

    fireEvent.keyDown(documentTab, { key: 'ArrowRight' })

    const subdocTab = tabs.getByRole('tab', { name: '关联' })
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'subdoc')
    expect(subdocTab).toHaveFocus()
    expect(subdocTab).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(subdocTab, { key: 'Home' })
    expect(tabs.getByRole('tab', { name: '笔记库' })).toHaveFocus()
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'tree')
  })

  it('exposes resizer values and supports keyboard width changes', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const separator = screen.getByRole('separator', { name: '调整笔记库导航宽度' })
    const before = Number(separator.getAttribute('aria-valuenow'))

    expect(separator).toHaveAttribute('tabindex', '0')
    expect(separator).toHaveAttribute('aria-valuemin', '180')
    expect(separator).toHaveAttribute('aria-valuemax')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', String(before + 10))
  })

  it('pauses toast dismissal while an action inside it has focus', () => {
    vi.useFakeTimers()
    try {
      act(() => useWorkbench.getState().setToast('需要阅读的提示'))
      render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
      const close = screen.getByRole('button', { name: '关闭提示' })
      fireEvent.focus(close)

      act(() => vi.advanceTimersByTime(9000))
      expect(screen.getByText('需要阅读的提示')).toBeInTheDocument()

      fireEvent.blur(close, { relatedTarget: document.body })
      act(() => vi.advanceTimersByTime(8000))
      expect(screen.queryByText('需要阅读的提示')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns to the document panel after selecting a tree node', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const tabs = within(screen.getByRole('tablist', { name: '工作区面板' }))
    fireEvent.click(tabs.getByRole('tab', { name: '笔记库' }))
    fireEvent.click(screen.getByRole('button', { name: 'child' }))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-mobile-panel', 'main')
  })

  it('offers keyboard navigation for child tabs beyond the first six', () => {
    const children = Array.from({ length: 8 }, (_, index) => ({
      ...node(`child-${index + 1}`, 'root'),
      sort_order: index,
      user_input: `第 ${index + 1} 个很长的派生分支标题`,
    }))
    act(() => useWorkbench.getState().loadTree({ nodes: [node('root', null), ...children], rootNodeId: 'root', treeId: 'many' }))
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '更多 (2)' }))
    const listbox = screen.getByRole('listbox', { name: '更多关联内容' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(useWorkbench.getState().activeSubdocId).toBe('child-8')
  })

  it('starts two selection expansions through the UI with independent streams and two live right-panel tabs', async () => {
    const root = {
      ...node('root', null),
      ai_response: JSON.stringify({
        content: [{ content: [{ text: '讲了 Redis 和内存', type: 'text' }], type: 'paragraph' }],
        type: 'doc',
      }),
    }
    const children = {
      '分支 A': { ...node('child-a', 'root'), status: 'draft' as const, user_input: null },
      '分支 B': { ...node('child-b', 'root'), status: 'draft' as const, user_input: null },
    }
    const fork = vi.fn(async (_nodeId: string, input: { seedText: keyof typeof children }) => ({
      annotation: { id: `ann-${input.seedText}` },
      childNode: children[input.seedText],
    }))
    const streamAnswer = vi.fn((
      _nodeId: string,
      _question: string,
      _handlers: unknown,
      signal?: AbortSignal,
    ) => new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true })))
    const api = {
      fork,
      getNode: vi.fn(() => new Promise(() => {})),
      listTrees: vi.fn(() => new Promise(() => {})),
      streamAnswer,
    }
    useWorkbench.getState().loadTree({ nodes: [root], rootNodeId: 'root', treeId: 't' })
    render(<ApiProvider api={api as never}><Workbench /></ApiProvider>)

    const body = screen.getByTestId('doc-view').querySelector('.doc-body')!
    const redis = selectText(body, 'Redis')
    fireEvent.click(screen.getByRole('menuitem', { name: '就此展开' }))
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '分支 A' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenCalledTimes(1))

    const memory = selectText(body, '内存')
    fireEvent.click(screen.getByRole('menuitem', { name: '就此展开' }))
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '分支 B' } })
    fireEvent.click(screen.getByRole('button', { name: '就此展开' }))
    await waitFor(() => expect(streamAnswer).toHaveBeenCalledTimes(2))

    const redisKey = generationTaskKeys.forkExpand('root', redis.from, redis.to)
    const memoryKey = generationTaskKeys.forkExpand('root', memory.from, memory.to)
    const redisTask = generationTaskRegistry.getSnapshot().byKey[redisKey]
    const memoryTask = generationTaskRegistry.getSnapshot().byKey[memoryKey]
    const firstSignal = streamAnswer.mock.calls[0]?.[3]
    const secondSignal = streamAnswer.mock.calls[1]?.[3]

    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal).not.toBe(secondSignal)
    expect(firstSignal).toBe(redisTask.controller.signal)
    expect(secondSignal).toBe(memoryTask.controller.signal)
    expect(generationTaskRegistry.isTaskLive(redisTask)).toBe(true)
    expect(generationTaskRegistry.isTaskLive(memoryTask)).toBe(true)
    expect(useWorkbench.getState().nodesById['child-a'].status).toBe('streaming')
    expect(useWorkbench.getState().nodesById['child-b'].status).toBe('streaming')
    expect(screen.getByText('2 个关联内容生成中')).toHaveAttribute('data-gen-status', 'streaming')
    expect(screen.getByRole('tab', { name: '分支 A，生成中' })).toHaveAttribute('data-gen-status', 'streaming')
    expect(screen.getByRole('tab', { name: '分支 A，生成中' })).toHaveAttribute('data-task-key', redisKey)
    expect(screen.getByRole('tab', { name: '分支 B，生成中' })).toHaveAttribute('data-gen-status', 'streaming')
    expect(screen.getByRole('tab', { name: '分支 B，生成中' })).toHaveAttribute('data-task-key', memoryKey)
  })

  it.each([1980, 1440])('keeps the document within a %dpx viewport and scrolls child tabs internally', (width) => {
    const previousInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    try {
      const children = Array.from({ length: 8 }, (_, index) => ({
        ...node(`viewport-child-${index}`, 'root'),
        sort_order: index,
      }))
      act(() => useWorkbench.getState().loadTree({
        nodes: [node('root', null), ...children],
        rootNodeId: 'root',
        treeId: `viewport-${width}`,
      }))
      render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
      const tabStrip = screen.getByRole('tablist', { name: '关联内容标签' })
      expect(tabStrip).toHaveClass('subdoc-tabs')
      expectCssDeclarations('.subdoc-tabs', {
        'flex-wrap': 'nowrap',
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
      })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousInnerWidth })
    }
  })

  it('declares at least 44px hit areas for stop, retry, and selection-menu actions', () => {
    const streaming = { ...node('a-streaming', 'root'), status: 'streaming' as const }
    const failed = { ...node('b-failed', 'root'), status: 'error' as const }
    useWorkbench.getState().loadTree({
      nodes: [node('root', null), streaming, failed],
      rootNodeId: 'root',
      treeId: 'hit-areas',
    })
    generationTaskRegistry.start({
      key: generationTaskKeys.forkExpand('root', 0, 4),
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
      targetNodeId: streaming.id,
    })
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    render(<SelectionMenu onClose={() => {}} onPick={() => {}} taskKey="fork-expand:root:5:7" x={10} y={10} />)

    expectDeclaredHitArea(screen.getByRole('button', { name: `停止生成：${streaming.user_input}` }), '.subdoc-stop-button')
    expectDeclaredHitArea(screen.getByRole('menuitem', { name: '就此展开' }), '.selection-menu button')
    fireEvent.click(screen.getByRole('tab', { name: `${failed.user_input}，生成失败` }))
    expectDeclaredHitArea(screen.getByRole('button', { name: 'retry' }), '.inline-error button')
  })

  it('remounts the tree panel when switching trees so local errors cannot leak', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)
    const firstTreeNav = screen.getByRole('navigation', { name: '笔记结构' })
    act(() => useWorkbench.getState().loadTree({ nodes: [node('other-root', null)], rootNodeId: 'other-root', treeId: 'other-tree' }))
    expect(screen.getByRole('navigation', { name: '笔记结构' })).not.toBe(firstTreeNav)
  })

  it('keeps a long main question to two lines until explicitly expanded', () => {
    const question = '这是一个需要在主工作区完整保留、但默认不应占据大面积首屏空间的问题。'.repeat(5)
    act(() => useWorkbench.getState().loadTree({
      nodes: [{ ...node('long-root', null), user_input: question }],
      rootNodeId: 'long-root',
      treeId: 'long-tree',
    }))
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    const heading = screen.getByRole('heading', { level: 2, name: question })
    expect(heading).toHaveClass('is-collapsed')
    expect(heading).toHaveStyle({ maxHeight: '2.9em' })
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(heading).toHaveClass('is-expanded')
  })
})
