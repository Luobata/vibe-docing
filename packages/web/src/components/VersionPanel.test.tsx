import type { NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { VersionPanel } from './VersionPanel'

describe('VersionPanel', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('lists immutable versions and upserts the new revert snapshot result', async () => {
    const node = { id: 'n', user_input: 'restored' } as NodeRow
    const api = {
      listVersions: vi.fn(async () => ({ versions: [
        { ai_response: null, change_kind: 'edit', created_at: '', id: 'v1', node_id: 'n', user_input: null, version_no: 1 },
        { ai_response: null, change_kind: 'merge', created_at: '', id: 'v2', node_id: 'n', user_input: null, version_no: 2 },
      ] })),
      revert: vi.fn(async () => ({ node })),
    }
    render(<ApiProvider api={api as never}><VersionPanel nodeId="n" /></ApiProvider>)
    expect(await screen.findByText(/v1/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '回退' })[0])
    await waitFor(() => expect(api.revert).toHaveBeenCalledWith('n', 1))
    expect(useWorkbench.getState().nodesById.n).toBe(node)
  })
})
