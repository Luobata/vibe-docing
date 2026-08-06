import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { TrashPanel } from './TrashPanel'

describe('TrashPanel', () => {
  it('lists soft-deleted nodes and restores without physical removal', async () => {
    const api = {
      getTrash: vi.fn(async () => ({ nodes: [{ id: 'd1', user_input: '被删的问题' }] })),
      restoreNode: vi.fn(async () => ({ ok: true })),
    }
    render(<ApiProvider api={api as never}><TrashPanel treeId="t" /></ApiProvider>)
    expect(await screen.findByText('被删的问题')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(api.restoreNode).toHaveBeenCalledWith('d1'))
    expect(screen.queryByText('被删的问题')).not.toBeInTheDocument()
  })
})
