import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { TreeLauncher } from './TreeLauncher'

const root = {
  ai_response: null, created_at: '', id: 'root', is_deleted: 0, model_override: null,
  parent_id: null, sort_order: 0, status: 'draft', tree_id: 't1', updated_at: '', user_input: null,
} satisfies NodeRow

describe('TreeLauncher', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('creates and loads a new tree', async () => {
    const api = {
      createTree: vi.fn(async () => ({ rootNode: root, tree: { id: 't1', title: '缓存' } })),
      listTrees: vi.fn(async () => ({ trees: [] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('新建笔记库标题'), { target: { value: '缓存' } })
    fireEvent.click(screen.getByRole('button', { name: '新建笔记库' }))
    await waitFor(() => expect(useWorkbench.getState().mainNodeId).toBe('root'))
    expect(api.createTree).toHaveBeenCalledWith('缓存')
    expect(useWorkbench.getState().treeTitle).toBe('缓存')
  })

  it('opens an existing tree through getTree', async () => {
    const api = {
      getTree: vi.fn(async () => ({ nodes: [root], tree: { id: 't1', root_node_id: 'root', title: '已有树' } })),
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '已有树' }] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '已有树' }))
    await waitFor(() => expect(api.getTree).toHaveBeenCalledWith('t1'))
    expect(useWorkbench.getState().treeId).toBe('t1')
    expect(useWorkbench.getState().treeTitle).toBe('已有树')
  })

  it('deletes a tree from the list after confirming', async () => {
    const api = {
      deleteTree: vi.fn(async () => ({ ok: true })),
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '要删的树' }] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '要删的树' })
    fireEvent.click(screen.getByRole('button', { name: '删除“要删的树”' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(dialog).toHaveTextContent('将删除笔记库“要删的树”，可在回收站恢复。')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(api.deleteTree).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '要删的树' })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('keeps the dialog open with an inline error when deleting a tree fails', async () => {
    const api = {
      deleteTree: vi.fn(async () => { throw new Error('network') }),
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '删不掉的树' }] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '删不掉的树' })

    fireEvent.click(screen.getByRole('button', { name: '删除“删不掉的树”' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认删除' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('删除笔记库失败，请稍后重试。')
    expect(screen.getByRole('button', { name: '删不掉的树' })).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('renames a tree inline', async () => {
    const api = {
      listTrees: vi.fn(async () => ({ trees: [{ id: 't1', root_node_id: 'root', title: '旧名' }] })),
      renameTree: vi.fn(async () => ({ tree: { id: 't1', root_node_id: 'root', title: '新名' } })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '旧名' })
    fireEvent.click(screen.getByRole('button', { name: '重命名“旧名”' }))
    const editor = screen.getByLabelText('重命名笔记库')
    fireEvent.change(editor, { target: { value: '新名' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(api.renameTree).toHaveBeenCalledWith('t1', '新名'))
    expect(await screen.findByRole('button', { name: '新名' })).toBeInTheDocument()
  })

  it('hints why 新建笔记库 is disabled when the title is empty', () => {
    const api = { listTrees: vi.fn(async () => ({ trees: [] })) }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const button = screen.getByRole('button', { name: '新建笔记库' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '请先输入名称')
  })

  it('does not create on Enter during IME composition or when the title is empty', async () => {
    const api = {
      createTree: vi.fn(async () => ({ rootNode: root, tree: { id: 't1', title: '缓存' } })),
      listTrees: vi.fn(async () => ({ trees: [] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const input = screen.getByLabelText('新建笔记库标题')

    // Enter with no title → no create
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.createTree).not.toHaveBeenCalled()

    // Enter while IME is composing (confirming a Pinyin candidate) → no create
    fireEvent.change(input, { target: { value: '缓存' } })
    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' })
    expect(api.createTree).not.toHaveBeenCalled()

    // Plain Enter with a title → creates once
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.createTree).toHaveBeenCalledWith('缓存'))
    expect(api.createTree).toHaveBeenCalledOnce()
  })
})

describe('TreeLauncher folders', () => {
  const tree = (id: string, title: string, folder: string | null = null) => ({
    created_at: '', folder, id, is_deleted: 0 as const, root_node_id: 'root', title, updated_at: '',
  })

  beforeEach(() => {
    localStorage.removeItem('vibe-docing:tree-folders')
    useWorkbench.getState().reset()
  })

  it('groups trees into nested folders with recursive counts and ungrouped first', async () => {
    const api = {
      listTrees: vi.fn(async () => ({
        trees: [
          tree('t1', '缓存笔记', '工作/后端'),
          tree('t2', '前端笔记', '工作/前端'),
          tree('t3', '周报', '工作'),
          tree('t4', '随想'),
        ],
      })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    // 未分组置顶 + 递归计数（工作=3，后端/前端各 1）
    expect(await screen.findByRole('button', { name: '收起文件夹“未分组”' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: '收起文件夹“工作”' })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: '收起文件夹“后端”' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: '收起文件夹“前端”' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: '缓存笔记' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '随想' })).toBeInTheDocument()
  })

  it('collapses folders with persistence and navigates rows with arrow keys', async () => {
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作/后端'), tree('t2', '随想')] })),
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    const ungrouped = await screen.findByRole('button', { name: '收起文件夹“未分组”' })
    ungrouped.focus()
    fireEvent.keyDown(ungrouped, { key: 'ArrowDown' }) // → 未分组内的库行「随想」
    const freeform = screen.getByRole('button', { name: '随想' })
    expect(freeform).toHaveFocus()
    fireEvent.keyDown(freeform, { key: 'ArrowDown' }) // → 文件夹头「工作」
    const work = screen.getByRole('button', { name: '收起文件夹“工作”' })
    expect(work).toHaveFocus()
    // ← 折叠工作文件夹，嵌套键写入 localStorage；子库行隐藏
    fireEvent.keyDown(work, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: '展开文件夹“工作”' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '缓存笔记' })).toBeNull()
    expect(localStorage.getItem('vibe-docing:tree-folders')).toContain('工作')
    // → 重新展开
    fireEvent.keyDown(screen.getByRole('button', { name: '展开文件夹“工作”' }), { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '缓存笔记' })).toBeInTheDocument()
  })

  it('moves a tree into a folder and regroups immediately', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t2', '随想', '工作') }))
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作'), tree('t2', '随想')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '随想' })
    fireEvent.click(screen.getByRole('button', { name: '移动“随想”到文件夹' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '工作' }))
    await waitFor(() => expect(setTreeFolder).toHaveBeenCalledWith('t2', '工作'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起文件夹“工作”' })).toHaveTextContent('2')
    })
    expect(screen.queryByRole('button', { name: '收起文件夹“未分组”' })).toBeNull()
  })

  it('moves a tree out of its folder via the menu item', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t1', '缓存笔记', null) }))
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '缓存笔记' })
    fireEvent.click(screen.getByRole('button', { name: '移动“缓存笔记”到文件夹' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移出文件夹' }))
    await waitFor(() => expect(setTreeFolder).toHaveBeenCalledWith('t1', null))
    // 全部移出后无文件夹，列表回归平铺
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /文件夹“/ })).toBeNull()
    })
    expect(screen.getByRole('button', { name: '缓存笔记' })).toBeInTheDocument()
  })

  it('creates a tree into a folder via the 文件夹/名称 shortcut', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t9', '缓存', '工作/后端') }))
    const api = {
      createTree: vi.fn(async () => ({ rootNode: root, tree: { id: 't9', title: '缓存' } })),
      listTrees: vi.fn(async () => ({ trees: [] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('新建笔记库标题'), { target: { value: '工作/后端/缓存' } })
    fireEvent.keyDown(screen.getByLabelText('新建笔记库标题'), { key: 'Enter' })
    await waitFor(() => expect(api.createTree).toHaveBeenCalledWith('缓存'))
    await waitFor(() => expect(setTreeFolder).toHaveBeenCalledWith('t9', '工作/后端'))
    expect(useWorkbench.getState().treeTitle).toBe('缓存')
  })
})

/* 拖拽归档（Round 15）：原生 DnD + 确认弹窗。jsdom 无真实 DataTransfer，
   用 mock dataTransfer 驱动 fireEvent.dragStart/dragOver/drop。 */
describe('TreeLauncher drag-and-drop into folders', () => {
  const DND_MIME = 'application/x-vibe-item'
  const dndData = (types = [DND_MIME]) => ({ dropEffect: '', effectAllowed: '', setData: vi.fn(), types })
  const tree = (id: string, title: string, folder: string | null = null) => ({
    created_at: '', folder, id, is_deleted: 0 as const, root_node_id: 'root', title, updated_at: '',
  })

  beforeEach(() => {
    localStorage.removeItem('vibe-docing:tree-folders')
    useWorkbench.getState().reset()
  })

  it('moves a tree into a folder via drag-drop after confirming', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t2', '随想', '工作') }))
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作'), tree('t2', '随想')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)

    const item = await screen.findByRole('button', { name: '随想' })
    expect(item).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(item, { dataTransfer: dndData() })
    const work = screen.getByRole('button', { name: '收起文件夹“工作”' })
    fireEvent.dragOver(work, { dataTransfer: dndData() })
    expect(work.className).toContain('is-drop-target')
    fireEvent.drop(work, { dataTransfer: dndData() })

    // drop 不直接生效，先弹确认
    expect(setTreeFolder).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: '移动笔记库' })
    expect(dialog).toHaveTextContent('将「随想」移入文件夹「工作」？')
    fireEvent.click(within(dialog).getByRole('button', { name: '移入' }))

    await waitFor(() => expect(setTreeFolder).toHaveBeenCalledWith('t2', '工作'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起文件夹“工作”' })).toHaveTextContent('2')
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('moves a tree out of its folder by dropping onto 未分组', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t1', '缓存笔记', null) }))
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作'), tree('t2', '随想')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)

    fireEvent.dragStart(await screen.findByRole('button', { name: '缓存笔记' }), { dataTransfer: dndData() })
    const ungrouped = screen.getByRole('button', { name: '收起文件夹“未分组”' })
    fireEvent.dragOver(ungrouped, { dataTransfer: dndData() })
    expect(ungrouped.className).toContain('is-drop-target')
    fireEvent.drop(ungrouped, { dataTransfer: dndData() })

    const dialog = screen.getByRole('alertdialog', { name: '移动笔记库' })
    expect(dialog).toHaveTextContent('将「缓存笔记」移出文件夹？')
    fireEvent.click(within(dialog).getByRole('button', { name: '移入' }))
    await waitFor(() => expect(setTreeFolder).toHaveBeenCalledWith('t1', null))
  })

  it('cancelling the dialog performs no move at all', async () => {
    const setTreeFolder = vi.fn(async () => ({ tree: tree('t2', '随想', '工作') }))
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作'), tree('t2', '随想')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)

    fireEvent.dragStart(await screen.findByRole('button', { name: '随想' }), { dataTransfer: dndData() })
    const work = screen.getByRole('button', { name: '收起文件夹“工作”' })
    fireEvent.dragOver(work, { dataTransfer: dndData() })
    fireEvent.drop(work, { dataTransfer: dndData() })

    const dialog = screen.getByRole('alertdialog', { name: '移动笔记库' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(setTreeFolder).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '收起文件夹“工作”' })).toHaveTextContent('1')
  })

  it('ignores dropping back onto the current folder and rejects external drags', async () => {
    const setTreeFolder = vi.fn()
    const api = {
      listTrees: vi.fn(async () => ({ trees: [tree('t1', '缓存笔记', '工作'), tree('t2', '随想')] })),
      setTreeFolder,
    }
    render(<ApiProvider api={api as never}><TreeLauncher /></ApiProvider>)
    await screen.findByRole('button', { name: '缓存笔记' })

    // 原位：缓存笔记已在 工作 → 不高亮、不弹窗
    fireEvent.dragStart(screen.getByRole('button', { name: '缓存笔记' }), { dataTransfer: dndData() })
    const work = screen.getByRole('button', { name: '收起文件夹“工作”' })
    fireEvent.dragOver(work, { dataTransfer: dndData() })
    expect(work.className).not.toContain('is-drop-target')
    fireEvent.drop(work, { dataTransfer: dndData() })
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // 外部拖入：无 dragstart 且 types 不含自定义 MIME → 一律拒绝
    fireEvent.dragOver(work, { dataTransfer: dndData(['Files']) })
    expect(work.className).not.toContain('is-drop-target')
    fireEvent.drop(work, { dataTransfer: dndData(['Files']) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(setTreeFolder).not.toHaveBeenCalled()
  })
})
