import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { Breadcrumb } from './Breadcrumb'
import { TreePanel } from './TreePanel'

function node(id: string, parentId: string | null, input: string | null): NodeRow {
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
    user_input: input,
  }
}

describe('tree and breadcrumb navigation', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })

  it('renders the nested tree and switches the main document', () => {
    render(<TreePanel />)

    fireEvent.click(screen.getByRole('button', { name: '缓存问题' }))

    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })

  it('collapses and re-expands a branch with a dedicated disclosure control', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByRole('button', { name: '收起“根”' }))
    expect(screen.queryByRole('button', { name: '缓存问题' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开“根”' }))
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
  })

  it('renames a child title without invoking generation', async () => {
    const editNode = vi.fn(async (_id: string, body: { userInput: string }) => ({
      node: node('a', 'root', body.userInput),
    }))
    render(<ApiProvider api={{ editNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '重命名“缓存问题”' }))
    const input = screen.getByLabelText('重命名“缓存问题”')
    fireEvent.change(input, { target: { value: '缓存排查记录' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(editNode).toHaveBeenCalledWith('a', { userInput: '缓存排查记录' }))
    expect(screen.getByRole('button', { name: '缓存排查记录' })).toBeInTheDocument()
  })

  it('creates a blank note below the current selection and opens it', async () => {
    const created = node('blank', 'root', '会议记录')
    const createBlankNote = vi.fn(async () => ({ node: created }))
    render(<ApiProvider api={{ createBlankNote } as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '新建空白笔记' }))
    fireEvent.change(screen.getByLabelText('空白笔记标题'), { target: { value: '会议记录' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))

    await waitFor(() => expect(createBlankNote).toHaveBeenCalledWith('root', '会议记录'))
    expect(useWorkbench.getState().mainNodeId).toBe('blank')
    expect(screen.getByRole('button', { name: '会议记录' })).toBeInTheDocument()
  })

  it('renders a clickable breadcrumb and drives back/forward controls', () => {
    useWorkbench.getState().setMain('a')
    render(<Breadcrumb />)

    expect(screen.getByLabelText('面包屑')).toHaveTextContent('根缓存问题')
    fireEvent.click(screen.getByRole('button', { name: '根' }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
    fireEvent.click(screen.getByRole('button', { name: '后退' }))
    expect(useWorkbench.getState().mainNodeId).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    expect(useWorkbench.getState().mainNodeId).toBe('root')
  })
})

describe('tree node deletion', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题'), node('b', 'a', '子问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => useWorkbench.getState().reset())

  it('shows a delete control on the root node', () => {
    const api = { deleteNode: vi.fn(), getNode: vi.fn(() => new Promise(() => {})) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)
    // root ('根') now has a delete button (deletes the whole tree)
    expect(screen.getByRole('button', { name: '删除“根”' })).toBeInTheDocument()
  })

  it('deletes a non-root subtree after confirming the cascade count, then offers undo', async () => {
    const restoreNode = vi.fn(async () => ({ ok: true }))
    const api = {
      deleteNode: vi.fn(async () => ({ ok: true })),
      getNode: vi.fn(() => new Promise(() => {})),
      restoreNode,
    }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '删除“缓存问题”' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(dialog).toHaveTextContent('共 2 个')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(api.deleteNode).toHaveBeenCalledWith('a'))
    // subtree gone from the tree view
    await waitFor(() => expect(screen.queryByRole('button', { name: '缓存问题' })).toBeNull())

    // an undo affordance appears; clicking it restores
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() => expect(restoreNode).toHaveBeenCalledWith('a'))
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
  })

  it('does not delete when the dialog is cancelled and returns focus to the trigger', async () => {
    const api = { deleteNode: vi.fn(), getNode: vi.fn(() => new Promise(() => {})) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)
    const trigger = screen.getByRole('button', { name: '删除“缓存问题”' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(api.deleteNode).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('root node deletion', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    useWorkbench.getState().reset()
    vi.restoreAllMocks()
  })

  it('root delete button triggers deleteTree on the whole tree', async () => {
    const api = { deleteTree: vi.fn().mockResolvedValue({ ok: true }) }
    render(<ApiProvider api={api as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByLabelText('删除“根”'))
    const dialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(dialog).toHaveTextContent('将删除笔记库“根”及其中全部内容')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(api.deleteTree).toHaveBeenCalledWith('t'))
  })
})

describe('tree keyboard navigation (roving tabindex)', () => {
  beforeEach(() => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [node('root', null, null), node('a', 'root', '缓存问题'), node('b', 'root', '索引设计')],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => useWorkbench.getState().reset())

  it('moves focus between rows with ArrowDown/ArrowUp', () => {
    render(<TreePanel />)
    const rootRow = screen.getByRole('button', { name: '根' })
    rootRow.focus()
    fireEvent.keyDown(rootRow, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: '缓存问题' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '缓存问题' }), { key: 'ArrowUp' })
    expect(rootRow).toHaveFocus()
  })

  it('ArrowRight enters the first child; ArrowLeft returns to the parent, then collapses', () => {
    render(<TreePanel />)
    const rootRow = screen.getByRole('button', { name: '根' })
    rootRow.focus()
    fireEvent.keyDown(rootRow, { key: 'ArrowRight' }) // 已展开 → 进入首子
    const child = screen.getByRole('button', { name: '缓存问题' })
    expect(child).toHaveFocus()
    fireEvent.keyDown(child, { key: 'ArrowLeft' }) // 叶子 → 回到父行
    expect(rootRow).toHaveFocus()
    fireEvent.keyDown(rootRow, { key: 'ArrowLeft' }) // 折叠分支
    expect(screen.queryByRole('button', { name: '缓存问题' })).toBeNull()
    fireEvent.keyDown(rootRow, { key: 'ArrowRight' }) // 重新展开
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
  })

  it('Enter selects the focused row as the main document', () => {
    render(<TreePanel />)
    const child = screen.getByRole('button', { name: '缓存问题' })
    child.focus()
    fireEvent.keyDown(child, { key: 'Enter' })
    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })

  it('Home/End jump to the first/last visible row', () => {
    render(<TreePanel />)
    const rootRow = screen.getByRole('button', { name: '根' })
    rootRow.focus()
    fireEvent.keyDown(rootRow, { key: 'End' })
    expect(screen.getByRole('button', { name: '索引设计' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '索引设计' }), { key: 'Home' })
    expect(rootRow).toHaveFocus()
  })

  it('keeps exactly one tabbable main row button across the whole tree', () => {
    render(<TreePanel />)
    const mains = Array.from(document.querySelectorAll('.tree-node-main'))
    expect(mains.length).toBeGreaterThan(1)
    expect(mains.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('treats internal Vibe Derived/{treeTitle} paths as ungrouped and never suggests them', () => {
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [
        node('root', null, null),
        { ...node('a', 'root', '缓存问题'), file_path: 'Vibe Derived/检索库/a-abc123.md' },
        { ...node('b', 'root', '索引设计'), file_path: 'Vibe Derived/检索库/b-def456.md' },
        { ...node('c', 'root', '用户整理'), file_path: 'Vibe Derived/检索库/工作/c-789.md' },
      ],
      rootNodeId: 'root',
      treeId: 't',
      treeTitle: '检索库',
    })
    render(<TreePanel />)
    // 全部剥离树名层后：a/b 归未分组，c 留在用户目录「工作」。
    const ungrouped = screen.getByRole('button', { name: '收起目录“未分组”' })
    expect(ungrouped).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: '收起目录“工作”' })).toHaveTextContent('1')
    expect(screen.queryByRole('button', { name: '收起目录“Vibe Derived”' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起目录“检索库”' })).toBeNull()
    useWorkbench.getState().reset()
  })
})

describe('tree directory grouping and move', () => {
  beforeEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [
        node('root', null, null),
        { ...node('a', 'root', '缓存问题'), file_path: 'design/a.md' },
        { ...node('b', 'root', '索引设计'), file_path: 'design/b.md' },
        { ...node('c', 'root', '读书笔记'), file_path: 'reading/c.md' },
        node('d', 'root', '随手记'),
      ],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
  })

  it('groups children by dirname with collapsible headers, ungrouped first', () => {
    render(<TreePanel />)
    const ungrouped = screen.getByRole('button', { name: '收起目录“未分组”' })
    const design = screen.getByRole('button', { name: '收起目录“design”' })
    const reading = screen.getByRole('button', { name: '收起目录“reading”' })
    expect(ungrouped).toHaveTextContent('1')
    expect(design).toHaveTextContent('2')
    expect(reading).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: '缓存问题' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '随手记' })).toBeInTheDocument()
    // 目录头并入 roving：全树仍恰一个 tabIndex=0 行
    const rows = Array.from(document.querySelectorAll('[data-row-id]'))
    expect(rows.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('collapses a directory header via keyboard and persists to localStorage', () => {
    const { unmount } = render(<TreePanel />)
    const rootRow = screen.getByRole('button', { name: '根' })
    rootRow.focus()
    fireEvent.keyDown(rootRow, { key: 'ArrowDown' }) // → 未分组目录头
    const ungrouped = screen.getByRole('button', { name: '收起目录“未分组”' })
    expect(ungrouped).toHaveFocus()
    fireEvent.keyDown(ungrouped, { key: 'Enter' }) // 折叠
    expect(screen.getByRole('button', { name: '展开目录“未分组”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '随手记' })).toBeNull()
    expect(localStorage.getItem('vibe-docing:tree-dirs')).toContain('dir:root/')

    // 重挂载后折叠状态保留
    unmount()
    render(<TreePanel />)
    expect(screen.getByRole('button', { name: '展开目录“未分组”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '随手记' })).toBeNull()
  })

  it('moves a note into another directory and refreshes the grouping', async () => {
    const moved = { ...node('c', 'root', '读书笔记'), file_path: 'design/c.md' }
    const moveNode = vi.fn(async () => ({ node: moved }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '移动“读书笔记”到目录' }))
    const menu = screen.getByRole('menu', { name: '移动“读书笔记”到目录' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'design' }))

    await waitFor(() => expect(moveNode).toHaveBeenCalledWith('c', 'design'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起目录“design”' })).toHaveTextContent('3')
    })
    expect(screen.queryByRole('button', { name: '收起目录“reading”' })).toBeNull()
    expect(screen.getByRole('button', { name: '读书笔记' })).toBeInTheDocument()
  })

  it('moves a note to the root directory via the menu item', async () => {
    const moved = { ...node('a', 'root', '缓存问题'), file_path: 'a.md' }
    const moveNode = vi.fn(async () => ({ node: moved }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '移动“缓存问题”到目录' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移到根目录' }))
    await waitFor(() => expect(moveNode).toHaveBeenCalledWith('a', ''))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起目录“未分组”' })).toHaveTextContent('2')
    })
  })

  it('moves a note into a brand-new directory via the input row', async () => {
    const moved = { ...node('d', 'root', '随手记'), file_path: 'inbox/d.md' }
    const moveNode = vi.fn(async () => ({ node: moved }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.click(screen.getByRole('button', { name: '移动“随手记”到目录' }))
    const input = screen.getByLabelText('新目录名')
    fireEvent.change(input, { target: { value: 'inbox' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(moveNode).toHaveBeenCalledWith('d', 'inbox'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起目录“inbox”' })).toHaveTextContent('1')
    })
  })
})

describe('tree nested directory tree', () => {
  beforeEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [
        node('root', null, null),
        { ...node('x', 'root', '深入缓存'), file_path: 'a/b/x.md' },
        { ...node('y', 'root', '索引实践'), file_path: 'a/c/y.md' },
        { ...node('z', 'root', '概述'), file_path: 'a/z.md' },
        { ...node('w', 'root', '其他'), file_path: 'd/w.md' },
      ],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
  })

  it('nests shared directory prefixes and counts descendants recursively', () => {
    render(<TreePanel />)
    // 顶层目录头只显示段名，计数含递归子孙
    const dirA = screen.getByRole('button', { name: '收起目录“a”' })
    expect(dirA).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: '收起目录“d”' })).toHaveTextContent('1')
    // 第二层目录头段名 b / c（不显示全路径 a/b）
    expect(screen.getByRole('button', { name: '收起目录“b”' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: '收起目录“c”' })).toHaveTextContent('1')
    expect(screen.queryByRole('button', { name: /a\/b/ })).toBeNull()
    // 直属 a 的笔记与嵌套目录同层渲染
    expect(screen.getByRole('button', { name: '概述' })).toBeInTheDocument()
  })

  it('collapses a nested directory independently and persists full-path keys', () => {
    render(<TreePanel />)
    fireEvent.click(screen.getByRole('button', { name: '收起目录“b”' }))
    expect(screen.getByRole('button', { name: '展开目录“b”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '深入缓存' })).toBeNull()
    // 兄弟目录与父目录不受影响
    expect(screen.getByRole('button', { name: '索引实践' })).toBeInTheDocument()
    expect(localStorage.getItem('vibe-docing:tree-dirs')).toContain('dir:root/a/b')
    // 父目录折叠后嵌套键保留
    fireEvent.click(screen.getByRole('button', { name: '收起目录“a”' }))
    expect(localStorage.getItem('vibe-docing:tree-dirs')).toContain('dir:root/a')
  })

  it('navigates nested directory headers with the roving keyboard model', () => {
    render(<TreePanel />)
    const rootRow = screen.getByRole('button', { name: '根' })
    rootRow.focus()
    fireEvent.keyDown(rootRow, { key: 'ArrowDown' }) // → 目录 a
    const dirA = screen.getByRole('button', { name: '收起目录“a”' })
    expect(dirA).toHaveFocus()
    fireEvent.keyDown(dirA, { key: 'ArrowRight' }) // 已展开 → 进首子（目录 b）
    expect(screen.getByRole('button', { name: '收起目录“b”' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: '收起目录“b”' }), { key: 'ArrowLeft' }) // 折叠 b
    expect(screen.getByRole('button', { name: '展开目录“b”' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: '展开目录“b”' }), { key: 'ArrowLeft' }) // 回父目录 a
    expect(dirA).toHaveFocus()
  })
})

/* 拖拽归档（Round 15）：原生 DnD + 确认弹窗。jsdom 无真实 DataTransfer，
   用 mock dataTransfer 驱动 fireEvent.dragStart/dragOver/drop。 */
describe('tree drag-and-drop move', () => {
  const DND_MIME = 'application/x-vibe-item'
  const dndData = (types = [DND_MIME]) => ({ dropEffect: '', effectAllowed: '', setData: vi.fn(), types })

  beforeEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({
      nodes: [
        node('root', null, null),
        { ...node('a', 'root', '缓存问题'), file_path: 'design/a.md' },
        { ...node('b', 'root', '索引设计'), file_path: 'design/b.md' },
        { ...node('c', 'root', '读书笔记'), file_path: 'reading/c.md' },
        node('d', 'root', '随手记'),
      ],
      rootNodeId: 'root',
      treeId: 't',
    })
  })
  afterEach(() => {
    localStorage.removeItem('vibe-docing:tree-dirs')
    useWorkbench.getState().reset()
  })

  it('moves a note into a directory via drag-drop after confirming', async () => {
    const moved = { ...node('c', 'root', '读书笔记'), file_path: 'design/c.md' }
    const moveNode = vi.fn(async () => ({ node: moved }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    const note = screen.getByRole('button', { name: '读书笔记' })
    expect(note).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(note, { dataTransfer: dndData() })
    const design = screen.getByRole('button', { name: '收起目录“design”' })
    fireEvent.dragOver(design, { dataTransfer: dndData() })
    expect(design.className).toContain('is-drop-target')
    fireEvent.drop(design, { dataTransfer: dndData() })

    // drop 不直接生效，先弹确认
    expect(moveNode).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: '移动笔记' })
    expect(dialog).toHaveTextContent('将「读书笔记」移入文件夹「design」？')
    fireEvent.click(within(dialog).getByRole('button', { name: '移入' }))

    await waitFor(() => expect(moveNode).toHaveBeenCalledWith('c', 'design'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起目录“design”' })).toHaveTextContent('3')
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('moves a note back to the root directory via drag-drop', async () => {
    const moved = { ...node('a', 'root', '缓存问题'), file_path: 'a.md' }
    const moveNode = vi.fn(async () => ({ node: moved }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.dragStart(screen.getByRole('button', { name: '缓存问题' }), { dataTransfer: dndData() })
    const ungrouped = screen.getByRole('button', { name: '收起目录“未分组”' })
    fireEvent.dragOver(ungrouped, { dataTransfer: dndData() })
    expect(ungrouped.className).toContain('is-drop-target')
    fireEvent.drop(ungrouped, { dataTransfer: dndData() })

    const dialog = screen.getByRole('alertdialog', { name: '移动笔记' })
    expect(dialog).toHaveTextContent('将「缓存问题」移到根目录？')
    fireEvent.click(within(dialog).getByRole('button', { name: '移入' }))
    await waitFor(() => expect(moveNode).toHaveBeenCalledWith('a', ''))
  })

  it('cancelling the dialog performs no move at all', async () => {
    const moveNode = vi.fn(async () => ({ node: node('c', 'root', '读书笔记') }))
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    fireEvent.dragStart(screen.getByRole('button', { name: '读书笔记' }), { dataTransfer: dndData() })
    const design = screen.getByRole('button', { name: '收起目录“design”' })
    fireEvent.dragOver(design, { dataTransfer: dndData() })
    fireEvent.drop(design, { dataTransfer: dndData() })

    const dialog = screen.getByRole('alertdialog', { name: '移动笔记' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(moveNode).not.toHaveBeenCalled()
    // 分组保持原样
    expect(screen.getByRole('button', { name: '收起目录“design”' })).toHaveTextContent('2')
  })

  it('ignores dropping back onto the current directory (no highlight, no dialog)', () => {
    const moveNode = vi.fn()
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    // 索引设计已在 design：原位 dragover/drop 无高亮、无弹窗、无 API
    fireEvent.dragStart(screen.getByRole('button', { name: '索引设计' }), { dataTransfer: dndData() })
    const design = screen.getByRole('button', { name: '收起目录“design”' })
    fireEvent.dragOver(design, { dataTransfer: dndData() })
    expect(design.className).not.toContain('is-drop-target')
    fireEvent.drop(design, { dataTransfer: dndData() })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(moveNode).not.toHaveBeenCalled()
  })

  it('rejects external drags without the custom MIME type', () => {
    const moveNode = vi.fn()
    render(<ApiProvider api={{ moveNode } as never}><TreePanel /></ApiProvider>)

    // 外部拖入（如文件）：无 dragstart、types 不含自定义 MIME → 一律拒绝
    const design = screen.getByRole('button', { name: '收起目录“design”' })
    fireEvent.dragOver(design, { dataTransfer: dndData(['Files']) })
    expect(design.className).not.toContain('is-drop-target')
    fireEvent.drop(design, { dataTransfer: dndData(['Files']) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(moveNode).not.toHaveBeenCalled()
  })
})
