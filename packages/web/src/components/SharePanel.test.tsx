import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { SharePanel } from './SharePanel'

const share = { enabled: true as const, nodeId: 'node', url: '/share/token', markdownUrl: '/share/token.md', jsonUrl: '/share/token.json', createdAt: 'now', updatedAt: 'now' }

describe('SharePanel', () => {
  beforeEach(() => { useWorkbench.getState().reset() })

  it('shows creating state and copies only after success', async () => {
    let resolve!: (value: { share: typeof share }) => void
    const api = { getShare: vi.fn(async () => ({ share: null })), createShare: vi.fn(() => new Promise((done) => { resolve = done })), revokeShare: vi.fn() }
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ApiProvider api={api as never}><SharePanel disabled={false} nodeId="node" portal={document.body} /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    fireEvent.click(await screen.findByRole('button', { name: '创建分享链接' }))
    expect(screen.getByRole('button', { name: '正在创建…' })).toBeDisabled()
    resolve({ share })
    fireEvent.click(await screen.findByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/token`))
    expect(useWorkbench.getState().toast).toMatchObject({ message: '分享链接已复制', variant: 'success' })
    expect(api.createShare).toHaveBeenCalledWith('node')
    expect(screen.getByRole('link', { name: 'Markdown' })).toHaveAttribute('href', '/share/token.md')
    expect(screen.getByRole('link', { name: 'JSON' })).toHaveAttribute('href', '/share/token.json')
  })

  it('selects the URL on clipboard failure and keeps a failed revoke active', async () => {
    const revokeShare = vi.fn(async () => { throw new Error('offline') })
    const api = { getShare: vi.fn(async () => ({ share })), createShare: vi.fn(), revokeShare }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<ApiProvider api={api as never}><SharePanel disabled={false} nodeId="node" portal={document.body} /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    fireEvent.click(await screen.findByRole('button', { name: '复制链接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('链接已全选')
    fireEvent.click(screen.getByRole('button', { name: '关闭分享' }))
    fireEvent.click(screen.getByRole('button', { name: '确认关闭' }))
    expect(await screen.findByText('关闭失败，原链接仍然有效。请重试。')).toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/share/token`)).toBeInTheDocument()
    expect(revokeShare).toHaveBeenCalledWith('node')
  })

  it('ignores a stale share response after switching the current document', async () => {
    let resolveParent!: (value: { share: typeof share }) => void
    const childShare = { ...share, nodeId: 'child', url: '/share/child', markdownUrl: '/share/child.md' }
    const api = {
      getShare: vi.fn((nodeId: string) => nodeId === 'parent'
        ? new Promise<{ share: typeof share }>((done) => { resolveParent = done })
        : Promise.resolve({ share: childShare })),
      createShare: vi.fn(),
      revokeShare: vi.fn(),
    }
    const view = render(<ApiProvider api={api as never}><SharePanel disabled={false} nodeId="parent" portal={document.body} /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    await waitFor(() => expect(api.getShare).toHaveBeenCalledWith('parent'))

    view.rerender(<ApiProvider api={api as never}><SharePanel disabled={false} nodeId="child" portal={document.body} /></ApiProvider>)
    expect(await screen.findByDisplayValue(`${window.location.origin}/share/child`)).toBeInTheDocument()
    resolveParent({ share: { ...share, nodeId: 'parent', url: '/share/parent' } })

    await waitFor(() => expect(screen.getByDisplayValue(`${window.location.origin}/share/child`)).toBeInTheDocument())
    expect(screen.queryByDisplayValue(`${window.location.origin}/share/parent`)).not.toBeInTheDocument()
  })
})
