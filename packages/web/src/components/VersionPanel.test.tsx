import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { VersionPanel } from './VersionPanel'

describe('VersionPanel', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('lists immutable versions and upserts the new revert snapshot result', async () => {
    const node = { id: 'n', user_input: 'restored' } as NodeRow
    const api = {
      diffVersions: vi.fn(async () => ({ diff: [
        { text: '旧内容', type: 'del' as const },
        { text: '新内容', type: 'add' as const },
      ] })),
      listVersions: vi.fn(async () => ({ versions: [
        { ai_response: null, change_kind: 'edit', created_at: '', id: 'v1', node_id: 'n', user_input: null, version_no: 1 },
        { ai_response: null, change_kind: 'correction', created_at: '', id: 'v2', node_id: 'n', user_input: null, version_no: 2 },
      ] })),
      revert: vi.fn(async () => ({ node })),
    }
    render(<ApiProvider api={api as never}><VersionPanel nodeId="n" /></ApiProvider>)
    expect(await screen.findByText('版本 1')).toBeInTheDocument()
    expect(screen.getByText(/引导合并/)).toBeInTheDocument()
    act(() => useWorkbench.getState().bumpMergeRefresh())
    await waitFor(() => expect(api.listVersions).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '当前版本' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '查看变化' }))
    expect(await screen.findByLabelText('版本 1 的变化')).toHaveTextContent('旧内容')
    expect(api.diffVersions).toHaveBeenCalledWith('n', 1, 2)
    fireEvent.click(screen.getByRole('button', { name: '恢复此版本' }))
    const dialog = screen.getByRole('alertdialog', { name: '恢复版本 1？' })
    expect(dialog).toHaveTextContent('恢复前的内容会作为新版本保留')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认恢复' }))
    await waitFor(() => expect(api.revert).toHaveBeenCalledWith('n', 1))
    expect(useWorkbench.getState().nodesById.n).toBe(node)
    expect(useWorkbench.getState().toast).toEqual(expect.objectContaining({ variant: 'success' }))
  })
})
