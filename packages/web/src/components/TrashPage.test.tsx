import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { TrashPage } from './TrashPage'

describe('TrashPage', () => {
  it('manages deleted nodes and trees on the standalone page', async () => {
    const api = {
      getTrash: vi.fn(async () => ({ nodes: [{ id: 'd1', user_input: '被删的问题' }] })),
      listDeletedTrees: vi.fn(async () => ({ trees: [{ id: 't-deleted', title: '可恢复' }] })),
      restoreNode: vi.fn(async () => ({ ok: true })),
      restoreTree: vi.fn(async () => ({ tree: { id: 't-deleted', title: '可恢复' } })),
    }
    render(<ApiProvider api={api as never}><TrashPage onBack={() => {}} treeId="t" /></ApiProvider>)

    expect(await screen.findByText('被删的问题')).toBeInTheDocument()
    expect(screen.getByText('可恢复')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '恢复' })
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    await waitFor(() => expect(api.restoreNode).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(api.restoreTree).toHaveBeenCalledWith('t-deleted'))
  })
})
