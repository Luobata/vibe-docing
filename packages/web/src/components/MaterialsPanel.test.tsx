import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from '../api/client'
import { ApiProvider } from '../api/context'
import type { Material } from '../api/types'
import { MaterialsPanel } from './MaterialsPanel'

const material = (patch: Partial<Material> = {}): Material => ({ id: 'm1', tree_id: 'tree', title: '参考数据', content: 'Original content', content_hash: 'hash', enabled: 1, created_at: 'then', updated_at: 'now', ...patch })
function setup(initial: Material[] = []) {
  let records = [...initial]
  const api = {
    ...createApi(),
    listMaterials: vi.fn(async () => ({ materials: records })),
    createMaterial: vi.fn(async (_treeId: string, body: { content: string; title?: string }) => {
      const item = records.find((row) => row.content === body.content) ?? material({ id: `m${records.length + 1}`, title: body.title ?? body.content.trim().split('\n')[0].slice(0, 40), content: body.content })
      if (!records.some((row) => row.id === item.id)) records.push(item)
      return { material: item }
    }),
    updateMaterial: vi.fn(async (id: string, patch: { content?: string; title?: string; enabled?: boolean | 0 | 1 }) => {
      const previous = records.find((item) => item.id === id)!
      const item = { ...previous, ...patch, enabled: patch.enabled === undefined ? previous.enabled : Number(patch.enabled) as 0 | 1 }
      records = records.map((row) => row.id === id ? item : row)
      return { material: item }
    }),
    deleteMaterial: vi.fn(async (id: string) => { records = records.filter((row) => row.id !== id); return { ok: true as const } }),
  }
  const view = render(<ApiProvider api={api}><MaterialsPanel key="tree" treeId="tree" /></ApiProvider>)
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: '参考素材' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '素材内容' })).toBeEnabled())
  }
  const fill = (content: string, title?: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: '素材内容' }), { target: { value: content } })
    if (title !== undefined) fireEvent.change(screen.getByRole('textbox', { name: '标题（可选）' }), { target: { value: title } })
  }
  return { api, view, open, fill }
}

describe('MaterialsPanel', () => {
  it('loads on first expansion, saves pasted text and updates the list locally without polling or refetching on collapse', async () => {
    const { api, open, fill } = setup()
    expect(api.listMaterials).not.toHaveBeenCalled()
    await open()
    fill('First line\n  Keep spaces  ')
    fireEvent.click(screen.getByRole('button', { name: '保存素材' }))
    expect(await screen.findByRole('listitem', { name: 'First line' })).toBeInTheDocument()
    expect(api.createMaterial).toHaveBeenCalledWith('tree', { content: 'First line\n  Keep spaces  ' })
    expect(screen.getByRole('textbox', { name: '素材内容' })).toHaveValue('')
    expect(screen.getByText(/已用 1\/20 条/)).toHaveTextContent('26/50,000 字')
    fireEvent.click(screen.getByRole('button', { name: /参考素材/ }))
    fireEvent.click(screen.getByRole('button', { name: /参考素材/ }))
    expect(api.listMaterials).toHaveBeenCalledOnce()
  })

  it('counts raw characters, rejects blank or over-10k content, and permits the exact boundary', async () => {
    const { api, open, fill } = setup()
    await open()
    fill('   ')
    expect(screen.getByRole('button', { name: '保存素材' })).toBeDisabled()
    fill('字'.repeat(10_001))
    expect(screen.getByText(/10,001\/10,000 字/)).toHaveTextContent('超过单条上限')
    expect(screen.getByRole('textbox', { name: '素材内容' })).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: '保存素材' }))
    expect(api.createMaterial).not.toHaveBeenCalled()
    fill('字'.repeat(10_000), 'Exact boundary')
    expect(screen.getByRole('button', { name: '保存素材' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存素材' }))
    expect(await screen.findByRole('listitem', { name: 'Exact boundary' })).toBeInTheDocument()
  })

  it('switches enabled state with explanatory text and retains disabled content in capacity totals', async () => {
    const { api, open } = setup([material()])
    await open()
    const toggle = screen.getByRole('switch', { name: '启用素材：参考数据' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(await screen.findByText(/已停用·不进 AI 上下文/)).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    expect(api.updateMaterial).toHaveBeenLastCalledWith('m1', { enabled: false })
    expect(screen.getByText(/已用 1\/20 条/)).toHaveTextContent('16/50,000 字')
    fireEvent.click(toggle)
    expect(await screen.findByText(/已启用·作为讨论参考/)).toBeInTheDocument()
    expect(api.updateMaterial).toHaveBeenLastCalledWith('m1', { enabled: true })
  })

  it('edits the original text in place and can cancel an unsaved edit', async () => {
    const { api, open, fill } = setup([material()])
    await open()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('textbox', { name: '素材内容' })).toHaveValue('Original content')
    expect(screen.getByRole('textbox', { name: '标题（可选）' })).toHaveValue('参考数据')
    fill('Do not save')
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    expect(api.updateMaterial).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fill('Edited content', '新标题')
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(await screen.findByRole('listitem', { name: '新标题' })).toBeInTheDocument()
    expect(api.updateMaterial).toHaveBeenCalledWith('m1', { title: '新标题', content: 'Edited content' })
    expect(api.createMaterial).not.toHaveBeenCalled()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('requires deletion confirmation, supports cancel, and clears the editor when its material is deleted', async () => {
    const { api, open } = setup([material()])
    await open()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(api.deleteMaterial).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.deleteMaterial).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(await screen.findByText('素材已删除')).toBeInTheDocument()
    expect(api.deleteMaterial).toHaveBeenCalledWith('m1')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '素材内容' })).toHaveValue('')
  })

  it('keeps a failed deletion in the confirmation dialog with the server error and original row', async () => {
    const { api, open } = setup([material()])
    await open()
    api.deleteMaterial.mockRejectedValueOnce(new ApiError(500, { error: '删除暂时不可用' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('删除暂时不可用')
    expect(screen.getByRole('listitem')).toBeInTheDocument()
  })

  it.each(['rows', 'characters'])('shows the full-capacity hint for the %s limit including disabled materials', async (limit) => {
    const items = limit === 'rows' ? Array.from({ length: 20 }, (_, i) => material({ id: `m${i}`, title: `Source ${i}`, enabled: 0 }))
      : Array.from({ length: 5 }, (_, i) => material({ id: `m${i}`, title: `Source ${i}`, content: String(i).repeat(10_000), enabled: 0 }))
    const { open, fill } = setup(items)
    await open()
    expect(screen.getByText('当前容量已满，可编辑或删除已有素材；停用仍占容量。')).toBeInTheDocument()
    expect(screen.getByText(/已用/)).toHaveTextContent(limit === 'rows' ? '已用 20/20 条' : '50,000/50,000 字')
    fill(items[0].content)
    expect(screen.getByRole('button', { name: '保存素材' })).toBeEnabled()
  })

  it('keeps one row and its disabled state when create returns an existing material', async () => {
    const existing = material({ enabled: 0 })
    const { open, fill } = setup([existing])
    await open()
    fill(existing.content, 'New title ignored by server')
    fireEvent.click(screen.getByRole('button', { name: '保存素材' }))
    expect(await screen.findByText('相同内容已在列表中，保留原有状态')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.getByRole('listitem')).toHaveAccessibleName('参考数据')
  })

  it.each([[400, 'MATERIAL_TOO_LARGE', '单条素材不能超过 10,000 字符'], [400, 'TREE_MATERIAL_LIMIT', '每棵树最多保存 20 条素材'], [409, 'MATERIAL_ALREADY_EXISTS', '当前树中已有相同内容的素材']] as const)('shows %s %s verbatim and retains the draft for correction', async (status, code, error) => {
    const { api, open, fill } = setup(status === 409 ? [material()] : [])
    await open()
    if (status === 409) { fireEvent.click(screen.getByRole('button', { name: '编辑' })); api.updateMaterial.mockRejectedValueOnce(new ApiError(status, { code, error })) }
    else api.createMaterial.mockRejectedValueOnce(new ApiError(status, { code, error }))
    fill('Keep this draft')
    fireEvent.click(screen.getByRole('button', { name: status === 409 ? '保存修改' : '保存素材' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(screen.getByRole('textbox', { name: '素材内容' })).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: status === 409 ? '保存修改' : '保存素材' })).toBeEnabled()
  })

  it('retries failed initial loading and ignores a late load after a keyed tree switch', async () => {
    const { api, view } = setup()
    api.listMaterials.mockRejectedValueOnce(new ApiError(503, { error: '暂时无法加载' }))
    fireEvent.click(screen.getByRole('button', { name: '参考素材' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载')
    let finish!: (value: { materials: Material[] }) => void
    api.listMaterials.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }))
    view.rerender(<ApiProvider api={api}><MaterialsPanel key="other" treeId="other" /></ApiProvider>)
    await act(async () => { finish({ materials: [material()] }) })
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '参考素材' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '素材内容' })).toBeEnabled())
    expect(api.listMaterials).toHaveBeenLastCalledWith('other')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})
