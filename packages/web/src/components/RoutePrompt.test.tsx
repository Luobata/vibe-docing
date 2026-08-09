import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorNotice, RoutePrompt } from './RoutePrompt'

const candidate = { label: '缓存细节', refId: 'child', score: 0.91, target: 'bound-subdoc' as const }

describe('RoutePrompt', () => {
  afterEach(() => vi.useRealTimers())

  it('accepts a high-confidence migration suggestion', () => {
    const onAccept = vi.fn()
    render(<RoutePrompt decision={{ action: 'suggest', candidate }} onAccept={onAccept} onDismiss={() => {}} onPick={() => {}} />)
    expect(screen.getByText(/缓存细节/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搬过去' }))
    expect(onAccept).toHaveBeenCalledWith(candidate)
  })

  it('lists ambiguous candidates and keeps the main continuation escape hatch', () => {
    const onDismiss = vi.fn()
    const onPick = vi.fn()
    render(<RoutePrompt decision={{ action: 'ask', candidates: [candidate] }} onAccept={() => {}} onDismiss={onDismiss} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: '缓存细节' }))
    expect(onPick).toHaveBeenCalledWith(candidate)
    fireEvent.click(screen.getByRole('button', { name: '都不对，接主文档下' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('lets the user dismiss a non-blocking routing failure notice', () => {
    const onDismiss = vi.fn()
    render(<RouteErrorNotice message="智能路由暂时不可用" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('智能路由暂时不可用')
    fireEvent.click(screen.getByRole('button', { name: '关闭路由失败提示' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('automatically dismisses a routing failure notice after about eight seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<RouteErrorNotice message="智能路由暂时不可用" onDismiss={onDismiss} />)

    act(() => vi.advanceTimersByTime(7999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
