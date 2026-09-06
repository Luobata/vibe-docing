import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { SessionMap } from './SessionMap'
import { Workbench } from './Workbench'

function node(id: string, parentId: string | null, overrides: Partial<NodeRow> = {}): NodeRow {
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
    user_input: `问题 ${id}`,
    ...overrides,
  }
}

function loadDefaultTree(): void {
  useWorkbench.getState().loadTree({
    nodes: [
      node('root', null),
      node('child', 'root', { sort_order: 0 }),
      node('leaf', 'child', { sort_order: 0 }),
      node('sibling', 'root', { sort_order: 1 }),
    ],
    rootNodeId: 'root',
    treeId: 't',
    treeTitle: '研究笔记',
  })
}

describe('SessionMap', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbench.getState().reset()
    loadDefaultTree()
  })

  it('renders a modal dialog with a card per live node and connecting edges', () => {
    render(<SessionMap onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: '会话地图' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: /研究笔记/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /问题 leaf/ })).toBeInTheDocument()
    // Deleted nodes are excluded from the map.
    act(() => useWorkbench.getState().upsertNode({ ...node('sibling', 'root', { sort_order: 1 }), is_deleted: 1 }))
    expect(screen.queryByRole('button', { name: /问题 sibling/ })).not.toBeInTheDocument()
    // 4 live nodes minus the deleted sibling → 2 edges remain (root→child, child→leaf).
    expect(document.querySelectorAll('.session-map-edge')).toHaveLength(2)
  })

  it('focuses the close button on open and restores focus on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const onClose = vi.fn()
    const { unmount } = render(<SessionMap onClose={onClose} />)
    expect(screen.getByRole('button', { name: '关闭会话地图' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('dialog', { name: '会话地图' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('selects a node and closes when its card is activated', () => {
    const onClose = vi.fn()
    render(<SessionMap onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /问题 leaf/ }))
    expect(useWorkbench.getState().mainNodeId).toBe('leaf')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('marks the current node and highlights the main path edges', () => {
    render(<SessionMap onClose={() => {}} />)

    const current = screen.getByRole('button', { name: /研究笔记，完成，当前/ })
    expect(current.className).toMatch(/is-current/)
    expect(current).toHaveAttribute('aria-current', 'page')

    // mainPath is just [root]; no edge is fully on the path yet.
    expect(document.querySelectorAll('.session-map-edge.is-active')).toHaveLength(0)
    act(() => useWorkbench.getState().setMain('leaf'))
    const activeEdges = document.querySelectorAll('.session-map-edge.is-active')
    expect(activeEdges).toHaveLength(2)
  })

  it('shows unread dots, draft status, and an animated streaming badge', () => {
    // Unread markers are loaded from localStorage by loadTree.
    localStorage.setItem('vibe-docing:unread:t', JSON.stringify(['leaf']))
    act(() => {
      useWorkbench.getState().loadTree({
        nodes: [
          node('root', null),
          node('child', 'root', { sort_order: 0 }),
          node('leaf', 'child', { sort_order: 0 }),
          node('streaming', 'root', { sort_order: 2, status: 'streaming' }),
          node('drafty', 'root', { sort_order: 3, status: 'draft' }),
        ],
        rootNodeId: 'root',
        treeId: 't',
      })
    })

    render(<SessionMap onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /问题 streaming，生成中/ })).toBeInTheDocument()
    expect(document.querySelector('.session-map-card-status.is-animated')).not.toBeNull()
    expect(screen.getByRole('button', { name: /问题 drafty，草稿/ })).toBeInTheDocument()
    const unreadCard = screen.getByRole('button', { name: /问题 leaf，完成，未读/ })
    expect(unreadCard.querySelector('.session-map-card-unread')).not.toBeNull()
  })

  it('steps zoom in 10% increments within the 10%–200% range', () => {
    render(<SessionMap onClose={() => {}} />)
    const zoomValue = () => screen.getByLabelText('当前缩放')

    expect(zoomValue()).toHaveTextContent('100%')
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(zoomValue()).toHaveTextContent('110%')
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(zoomValue()).toHaveTextContent('90%')

    const shrink = screen.getByRole('button', { name: '缩小' })
    for (let i = 0; i < 20; i += 1) fireEvent.click(shrink)
    expect(zoomValue()).toHaveTextContent('10%')
    expect(screen.getByRole('button', { name: '缩小' })).toBeDisabled()

    const grow = screen.getByRole('button', { name: '放大' })
    for (let i = 0; i < 30; i += 1) fireEvent.click(grow)
    expect(zoomValue()).toHaveTextContent('200%')
    expect(grow).toBeDisabled()
  })

  it('offers fit-canvas and locate-current actions', () => {
    render(<SessionMap onClose={() => {}} />)
    expect(screen.getByRole('button', { name: '适应画布' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '定位当前' }))
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }))
    // Both actions keep the overlay alive and leave a valid zoom percentage.
    expect(screen.getByLabelText('当前缩放').textContent).toMatch(/%$/)
  })

  it('pans by dragging the canvas background without selecting a card', () => {
    const onClose = vi.fn()
    const { container } = render(<SessionMap onClose={onClose} />)
    const canvas = container.querySelector('.session-map-canvas')!
    const transformBefore = container.querySelector<HTMLElement>('.session-map-viewport')!.style.transform

    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 140, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    const transformAfter = container.querySelector<HTMLElement>('.session-map-viewport')!.style.transform
    expect(transformAfter).not.toBe(transformBefore)
    expect(onClose).not.toHaveBeenCalled()
    expect(useWorkbench.getState().mainNodeId).toBe('root')
  })

  it('shows an empty-state guide when only the root exists', () => {
    act(() => useWorkbench.getState().loadTree({
      nodes: [node('root', null)],
      rootNodeId: 'root',
      treeId: 't',
    }))
    render(<SessionMap onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /问题 root/ })).toBeInTheDocument()
    expect(screen.getByText(/还没有分支/)).toBeInTheDocument()
  })
})

describe('SessionMap entry in Workbench', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbench.getState().reset()
    loadDefaultTree()
  })

  it('opens the map from the main document header and closes via the close button', () => {
    render(<ApiProvider api={{ getNode: () => new Promise(() => {}), listTrees: () => new Promise(() => {}) } as never}><Workbench /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '会话地图' }))
    expect(screen.getByRole('dialog', { name: '会话地图' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭会话地图' }))
    expect(screen.queryByRole('dialog', { name: '会话地图' })).not.toBeInTheDocument()
  })
})

describe('SessionMap Round 3 interactions', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbench.getState().reset()
    loadDefaultTree()
  })

  function cardOf(name: RegExp): HTMLElement {
    return screen.getByRole('button', { name })
  }
  function wrapOf(card: HTMLElement): HTMLElement {
    return card.closest('.session-map-card-wrap') as HTMLElement
  }
  function hitPathOf(from: string, to: string): Element {
    const edge = document.querySelector(`.session-map-edge[data-edge-from="${from}"][data-edge-to="${to}"]`)
    const group = edge?.closest('g')
    const hit = group?.querySelector('.session-map-edge-hit')
    expect(hit, `hit path for ${from}->${to}`).not.toBeNull()
    return hit as Element
  }

  it('shows a hover preview card after 300ms and hides it on leave; focus also triggers it', () => {
    vi.useFakeTimers()
    try {
      act(() => useWorkbench.getState().loadTree({
        nodes: [
          node('root', null),
          node('leaf', 'root', {
            ai_response: '这是 leaf 的回答正文，用于预览摘要。',
            created_at: new Date().toISOString(),
          }),
        ],
        rootNodeId: 'root',
        treeId: 't',
      }))
      render(<SessionMap onClose={() => {}} />)
      const card = cardOf(/问题 leaf，完成/)

      fireEvent.mouseEnter(card)
      expect(document.querySelector('.session-map-preview')).toBeNull()
      act(() => vi.advanceTimersByTime(299))
      expect(document.querySelector('.session-map-preview')).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      const preview = document.querySelector('.session-map-preview')
      expect(preview).not.toBeNull()
      expect(preview).toHaveTextContent('问题 leaf')
      expect(preview).toHaveTextContent('这是 leaf 的回答正文')
      expect(preview).toHaveTextContent('刚刚')

      fireEvent.mouseLeave(card)
      expect(document.querySelector('.session-map-preview')).toBeNull()

      fireEvent.focus(card)
      act(() => vi.advanceTimersByTime(300))
      expect(document.querySelector('.session-map-preview')).not.toBeNull()
      fireEvent.blur(card)
      expect(document.querySelector('.session-map-preview')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('filters cards by a ≥2-char query and Escape clears the search before closing', () => {
    const onClose = vi.fn()
    render(<SessionMap onClose={onClose} />)
    const input = screen.getByLabelText('搜索节点')

    // 1 char does not filter.
    fireEvent.change(input, { target: { value: 'l' } })
    expect(document.querySelectorAll('.session-map-card-wrap.is-dimmed')).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'leaf' } })
    expect(wrapOf(cardOf(/问题 leaf，完成/)).className).not.toMatch(/is-dimmed/)
    expect(wrapOf(cardOf(/研究笔记/)).className).toMatch(/is-dimmed/)
    expect(wrapOf(cardOf(/问题 sibling/)).className).toMatch(/is-dimmed/)

    // Escape clears the search first; the map stays open.
    fireEvent.keyDown(screen.getByRole('dialog', { name: '会话地图' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
    expect(document.querySelectorAll('.session-map-card-wrap.is-dimmed')).toHaveLength(0)

    fireEvent.keyDown(screen.getByRole('dialog', { name: '会话地图' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dims non-unread cards when 只看未读 is toggled', () => {
    localStorage.setItem('vibe-docing:unread:t', JSON.stringify(['leaf']))
    act(() => loadDefaultTree())
    render(<SessionMap onClose={() => {}} />)

    const toggle = screen.getByRole('button', { name: '只看未读' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(wrapOf(cardOf(/问题 leaf，完成，未读/)).className).not.toMatch(/is-dimmed/)
    expect(wrapOf(cardOf(/问题 child/)).className).toMatch(/is-dimmed/)

    fireEvent.click(toggle)
    expect(document.querySelectorAll('.session-map-card-wrap.is-dimmed')).toHaveLength(0)
  })

  it('navigates the tree with arrow keys, Enter selects, Home returns to root', () => {
    render(<SessionMap onClose={() => {}} />)
    const root = cardOf(/研究笔记，完成，当前/)
    root.focus()
    expect(root).toHaveFocus()

    fireEvent.keyDown(root, { key: 'ArrowRight' })
    expect(cardOf(/问题 child，完成/)).toHaveFocus()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(cardOf(/问题 sibling，完成/)).toHaveFocus()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    expect(cardOf(/问题 child，完成/)).toHaveFocus()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(cardOf(/问题 leaf，完成/)).toHaveFocus()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' })
    expect(cardOf(/问题 child，完成/)).toHaveFocus()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    expect(cardOf(/研究笔记，完成，当前/)).toHaveFocus()
  })

  it('quick-branches via the ＋ button: setMain, close, and vibe:focus-ask', () => {
    const onClose = vi.fn()
    const focusAsk = vi.fn()
    window.addEventListener('vibe:focus-ask', focusAsk)
    try {
      render(<SessionMap onClose={onClose} />)
      const wrap = wrapOf(cardOf(/问题 leaf，完成/))
      const branch = within(wrap).getByRole('button', { name: '新建分支' })
      fireEvent.click(branch)
      expect(useWorkbench.getState().mainNodeId).toBe('leaf')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(focusAsk).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('vibe:focus-ask', focusAsk)
    }
  })

  it('marks selection-derived edges with a dot and tooltip, plain edges say 由提问派生', () => {
    act(() => useWorkbench.getState().loadTree({
      annotations: [{
        anchor_from: 0,
        anchor_to: 5,
        child_node_id: 'child',
        created_at: '',
        id: 'a1',
        kind: 'selection',
        node_id: 'root',
        note: null,
        quoted_text: '被选中的原文句子',
      }],
      nodes: [
        node('root', null),
        node('child', 'root', { sort_order: 0 }),
        node('leaf', 'child', { sort_order: 0 }),
      ],
      rootNodeId: 'root',
      treeId: 't',
    }))
    render(<SessionMap onClose={() => {}} />)

    const annotated = document.querySelector('.session-map-edge.is-annotated')
    expect(annotated).toHaveAttribute('data-edge-from', 'root')
    expect(annotated).toHaveAttribute('data-edge-to', 'child')
    expect(document.querySelector('.session-map-edge-dot')).not.toBeNull()

    fireEvent.mouseEnter(hitPathOf('root', 'child'), { clientX: 10, clientY: 10 })
    expect(document.querySelector('.session-map-edge-tip')).toHaveTextContent('派生自选区：「被选中的原文句子」')
    fireEvent.mouseLeave(hitPathOf('root', 'child'))
    expect(document.querySelector('.session-map-edge-tip')).toBeNull()

    fireEvent.mouseEnter(hitPathOf('child', 'leaf'), { clientX: 10, clientY: 10 })
    expect(document.querySelector('.session-map-edge-tip')).toHaveTextContent('由提问派生')
  })

  it('renders dashed merge arcs with a conclusion tooltip, never path-highlighted', () => {
    act(() => useWorkbench.getState().loadTree({
      merges: [{
        conclusion: '两条分支合并出的结论',
        created_at: '',
        id: 'm1',
        landing_segment_id: 's1',
        source_node_id: 'leaf',
        target_node_id: 'sibling',
      }],
      nodes: [
        node('root', null),
        node('child', 'root', { sort_order: 0 }),
        node('leaf', 'child', { sort_order: 0 }),
        node('sibling', 'root', { sort_order: 1 }),
      ],
      rootNodeId: 'root',
      treeId: 't',
    }))
    render(<SessionMap onClose={() => {}} />)

    const mergeEdge = document.querySelector('.session-map-merge-edge')
    expect(mergeEdge).toHaveAttribute('data-merge-id', 'm1')
    const hit = mergeEdge?.closest('g')?.querySelector('.session-map-edge-hit')
    expect(hit).not.toBeNull()
    fireEvent.mouseEnter(hit as Element, { clientX: 10, clientY: 10 })
    expect(document.querySelector('.session-map-edge-tip')).toHaveTextContent('合并结论：两条分支合并出的结论')

    // Merge arcs never join the main-path highlight.
    act(() => useWorkbench.getState().setMain('leaf'))
    expect(document.querySelectorAll('.session-map-edge.is-active').length).toBeGreaterThan(0)
    expect(document.querySelector('.session-map-merge-edge')?.getAttribute('class')).not.toMatch(/is-active/)
  })

  it('renders guided merge arcs distinctly with an instruction tooltip', () => {
    act(() => useWorkbench.getState().loadTree({
      merges: [{
        conclusion: '',
        created_at: '',
        direction: '先验证事实，再调整结论',
        id: 'correction-1',
        kind: 'correction',
        landing_segment_id: null,
        source_node_id: 'leaf',
        target_node_id: 'root',
      }],
      nodes: [node('root', null), node('leaf', 'root')],
      rootNodeId: 'root',
      treeId: 't',
    }))
    render(<SessionMap onClose={() => {}} />)

    const edge = document.querySelector('.session-map-merge-edge.is-correction')
    expect(edge).toHaveAttribute('data-merge-kind', 'correction')
    const hit = edge?.closest('g')?.querySelector('.session-map-edge-hit')
    fireEvent.mouseEnter(hit as Element, { clientX: 10, clientY: 10 })
    expect(document.querySelector('.session-map-edge-tip')).toHaveTextContent('合并说明：先验证事实，再调整结论')
  })

  it('drags a card beyond 4px to reposition and persists per tree; short drags stay clicks', () => {
    const onClose = vi.fn()
    render(<SessionMap onClose={onClose} />)
    const card = cardOf(/问题 leaf，完成/)
    expect(card).toHaveAttribute('data-x', '696')

    // Drag by 30px/20px. jsdom lacks PointerEvent, so dispatch MouseEvent-typed
    // pointer events to carry real coordinates.
    const pointer = (type: string, init: MouseEventInit) =>
      fireEvent(card, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
    pointer('pointerdown', { button: 0, clientX: 100, clientY: 100 })
    pointer('pointermove', { clientX: 130, clientY: 120 })
    pointer('pointerup', {})
    expect(card).toHaveAttribute('data-x', '726')
    expect(card).toHaveAttribute('data-y', '76')
    // v1 payload: positions + the node set captured at save time.
    const saved = JSON.parse(localStorage.getItem('vibe-docing:session-map-pos:t') ?? '{}') as {
      v: number
      nodeIds: string[]
      pos: Record<string, { x: number; y: number }>
    }
    expect(saved.v).toBe(1)
    expect(saved.nodeIds.sort()).toEqual(['child', 'leaf', 'root', 'sibling'])
    expect(saved.pos.leaf).toEqual({ x: 726, y: 76 })

    // The click right after a real drag is suppressed.
    fireEvent.click(card)
    expect(onClose).not.toHaveBeenCalled()

    // A ≤4px nudge is still a click: selects the node and closes.
    pointer('pointerdown', { button: 0, clientX: 200, clientY: 200 })
    pointer('pointermove', { clientX: 203, clientY: 202 })
    pointer('pointerup', {})
    fireEvent.click(card)
    expect(useWorkbench.getState().mainNodeId).toBe('leaf')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores legacy bare-map manual positions when the node set matches, and 自动整理 resets them', () => {
    // 旧格式（裸 {nodeId:{x,y}} map）兼容读取：等效 nodeIds = Object.keys，集合相等才生效。
    localStorage.setItem('vibe-docing:session-map-pos:t', JSON.stringify({
      child: { x: 380, y: 56 },
      leaf: { x: 900, y: 400 },
      root: { x: 56, y: 56 },
      sibling: { x: 56, y: 200 },
    }))
    const { unmount } = render(<SessionMap onClose={() => {}} />)
    const card = cardOf(/问题 leaf，完成/)
    expect(card).toHaveAttribute('data-x', '900')
    expect(card).toHaveAttribute('data-y', '400')
    // 有手动位置 → 自动整理按钮转强调态。
    const arrange = screen.getByRole('button', { name: '自动整理' })
    expect(arrange.className).toMatch(/is-manual/)
    expect(arrange).toHaveAttribute('title', '检测到手动摆放的卡片，点击恢复规整布局')

    fireEvent.click(arrange)
    expect(cardOf(/问题 leaf，完成/)).toHaveAttribute('data-x', '696')
    expect(localStorage.getItem('vibe-docing:session-map-pos:t')).toBeNull()
    // 清空后回普通 ghost 态。
    expect(screen.getByRole('button', { name: '自动整理' }).className).not.toMatch(/is-manual/)
    unmount()
  })

  it('discards stored manual positions when the saved node set differs from the tree', () => {
    // v1 格式但 nodeIds 含已不存在的节点 → 整批丢弃并清理存储。
    localStorage.setItem('vibe-docing:session-map-pos:t', JSON.stringify({
      v: 1,
      nodeIds: ['root', 'child', 'leaf'],
      pos: { leaf: { x: 900, y: 400 } },
    }))
    render(<SessionMap onClose={() => {}} />)
    expect(cardOf(/问题 leaf，完成/)).toHaveAttribute('data-x', '696')
    expect(localStorage.getItem('vibe-docing:session-map-pos:t')).toBeNull()
    expect(screen.getByRole('button', { name: '自动整理' }).className).not.toMatch(/is-manual/)
  })

  it('invalidates manual positions when the node set changes mid-session (add/remove)', () => {
    const pointer = (card: HTMLElement, type: string, init: MouseEventInit) =>
      fireEvent(card, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
    render(<SessionMap onClose={() => {}} />)
    const card = cardOf(/问题 leaf，完成/)
    pointer(card, 'pointerdown', { button: 0, clientX: 100, clientY: 100 })
    pointer(card, 'pointermove', { clientX: 130, clientY: 120 })
    pointer(card, 'pointerup', {})
    expect(card).toHaveAttribute('data-x', '726')
    expect(screen.getByRole('button', { name: '自动整理' }).className).toMatch(/is-manual/)

    // 新增节点 → 手动位置整批失效，指示态消失，存储清理。
    act(() => useWorkbench.getState().upsertNode(node('fresh', 'root', { sort_order: 2 })))
    expect(cardOf(/问题 leaf，完成/)).toHaveAttribute('data-x', '696')
    expect(screen.getByRole('button', { name: '自动整理' }).className).not.toMatch(/is-manual/)
    expect(localStorage.getItem('vibe-docing:session-map-pos:t')).toBeNull()

    // 删除同理：先拖出新位置，再删 sibling → 全部回正。
    const leaf = cardOf(/问题 leaf，完成/)
    pointer(leaf, 'pointerdown', { button: 0, clientX: 100, clientY: 100 })
    pointer(leaf, 'pointermove', { clientX: 140, clientY: 100 })
    pointer(leaf, 'pointerup', {})
    expect(cardOf(/问题 leaf，完成/)).toHaveAttribute('data-x', '736')
    act(() => useWorkbench.getState().upsertNode({ ...node('sibling', 'root', { sort_order: 1 }), is_deleted: 1 }))
    expect(cardOf(/问题 leaf，完成/)).toHaveAttribute('data-x', '696')
    expect(localStorage.getItem('vibe-docing:session-map-pos:t')).toBeNull()
  })

  it('switches layout density, reapplies spacing, and persists per tree', () => {
    render(<SessionMap onClose={() => {}} />)
    expect(cardOf(/问题 child，完成/)).toHaveAttribute('data-x', '376')

    const compact = screen.getByRole('button', { name: '紧凑' })
    fireEvent.click(compact)
    expect(compact).toHaveAttribute('aria-pressed', 'true')
    expect(cardOf(/问题 child，完成/)).toHaveAttribute('data-x', '344')
    expect(localStorage.getItem('vibe-docing:session-map-density:t')).toBe('compact')

    fireEvent.click(screen.getByRole('button', { name: '宽松' }))
    expect(cardOf(/问题 child，完成/)).toHaveAttribute('data-x', '424')
    expect(localStorage.getItem('vibe-docing:session-map-density:t')).toBe('relaxed')
  })

  it('pulses the border of streaming cards via a dedicated class', () => {
    act(() => useWorkbench.getState().loadTree({
      nodes: [
        node('root', null),
        node('streaming', 'root', { sort_order: 1, status: 'streaming' }),
      ],
      rootNodeId: 'root',
      treeId: 't',
    }))
    render(<SessionMap onClose={() => {}} />)
    expect(cardOf(/问题 streaming，生成中/).className).toMatch(/is-streaming/)
  })
})

describe('SessionMap legend', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbench.getState().reset()
    loadDefaultTree()
  })

  it('renders a collapsible legend with all four line styles', () => {
    render(<SessionMap onClose={() => {}} />)
    const legend = screen.getByRole('note', { name: '连线图例' })
    expect(legend.className).not.toMatch(/is-collapsed/)
    const items = legend.querySelectorAll('.session-map-legend-list li')
    expect(items).toHaveLength(4)
    expect(legend).toHaveTextContent('会话上下文（父子）')
    expect(legend).toHaveTextContent('由选区文字派生')
    expect(legend).toHaveTextContent('跨分支合并')
    expect(legend).toHaveTextContent('当前阅读路径')
  })

  it('collapses to a quiet 图例 button and expands again, without persisting', () => {
    render(<SessionMap onClose={() => {}} />)
    const toggle = screen.getByRole('button', { name: '折叠图例' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    const legend = screen.getByRole('note', { name: '连线图例' })
    expect(legend.className).toMatch(/is-collapsed/)
    expect(legend.querySelector('.session-map-legend-list')).toBeNull()
    const opener = screen.getByRole('button', { name: '展开图例' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(opener)
    expect(screen.getByRole('note', { name: '连线图例' }).querySelectorAll('.session-map-legend-list li')).toHaveLength(4)
  })

  it('does not let legend pointerdown bubble into a canvas pan', () => {
    const onClose = vi.fn()
    const { container } = render(<SessionMap onClose={onClose} />)
    const transformBefore = container.querySelector<HTMLElement>('.session-map-viewport')!.style.transform

    const legend = screen.getByRole('note', { name: '连线图例' })
    fireEvent.pointerDown(legend, { button: 0, clientX: 30, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(legend, { clientX: 90, clientY: 460, pointerId: 1 })
    fireEvent.pointerUp(legend, { pointerId: 1 })

    expect(container.querySelector<HTMLElement>('.session-map-viewport')!.style.transform).toBe(transformBefore)
    expect(onClose).not.toHaveBeenCalled()
    expect(useWorkbench.getState().mainNodeId).toBe('root')
  })
})
