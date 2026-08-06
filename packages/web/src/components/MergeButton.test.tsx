import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { MergeButton } from './MergeButton'

describe('MergeButton', () => {
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
})
