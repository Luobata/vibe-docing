import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { MergeButton } from './MergeButton'

describe('MergeButton', () => {
  afterEach(() => useWorkbench.getState().reset())

  it('merges through the single source-to-target entry and shows a light success state', async () => {
    const api = { merge: vi.fn(async () => ({ merge: { id: 'm1' }, segment: { id: 's1' } })) }
    render(<ApiProvider api={api as never}><MergeButton sourceNodeId="child" targetNodeId="root" /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '合并回父节点' }))
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('child', 'root'))
    expect(await screen.findByText('已合并')).toBeInTheDocument()
  })

  it('keeps the branch available when merge fails', async () => {
    const api = { merge: vi.fn(async () => { throw new Error('offline') }) }
    render(<ApiProvider api={api as never}><MergeButton sourceNodeId="child" targetNodeId="root" /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '合并回父节点' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('合并失败')
    expect(screen.getByRole('button', { name: '合并回父节点' })).toBeEnabled()
  })

  it('keeps merged state after remount (tab switch) via store', async () => {
    const api = { merge: vi.fn().mockResolvedValue({}) }
    const { unmount } = render(
      <ApiProvider api={api as never}><MergeButton sourceNodeId="s1" targetNodeId="p1" /></ApiProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('已合并')).toBeInTheDocument()
    unmount()
    render(
      <ApiProvider api={api as never}><MergeButton sourceNodeId="s1" targetNodeId="p1" /></ApiProvider>,
    )
    expect(screen.getByText('已合并')).toBeInTheDocument()
  })
})
