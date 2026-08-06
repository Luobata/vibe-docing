import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAutoScroll } from './use-auto-scroll'

function fakeScrollEl(): { el: HTMLDivElement; setScrollTop(v: number): void } {
  const el = document.createElement('div')
  let scrollTop = 0
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v },
  })
  return { el, setScrollTop: (v) => { scrollTop = v } }
}

describe('useAutoScroll', () => {
  it('pins to the bottom when the dependency changes', () => {
    const { el } = fakeScrollEl()
    const ref = { current: el }
    const { rerender } = renderHook(({ dep }) => useAutoScroll(ref, dep), { initialProps: { dep: 0 } })
    act(() => { rerender({ dep: 1 }) })
    expect(el.scrollTop).toBe(el.scrollHeight)
  })

  it('stops auto-pinning after the user scrolls up and shows the jump button', () => {
    const { el, setScrollTop } = fakeScrollEl()
    const ref = { current: el }
    const hook = renderHook(({ dep }) => useAutoScroll(ref, dep), { initialProps: { dep: 0 } })
    // user scrolls up (far from bottom)
    setScrollTop(100)
    act(() => { el.dispatchEvent(new Event('scroll')) })
    expect(hook.result.current.showButton).toBe(true)
    // new content arrives — must NOT yank back to bottom
    act(() => { hook.rerender({ dep: 1 }) })
    expect(el.scrollTop).toBe(100)
  })

  it('scrollToBottom returns to the bottom and hides the button', () => {
    const { el, setScrollTop } = fakeScrollEl()
    const ref = { current: el }
    const hook = renderHook(({ dep }) => useAutoScroll(ref, dep), { initialProps: { dep: 0 } })
    setScrollTop(100)
    act(() => { el.dispatchEvent(new Event('scroll')) })
    act(() => { hook.result.current.scrollToBottom() })
    expect(el.scrollTop).toBe(el.scrollHeight)
    expect(hook.result.current.showButton).toBe(false)
  })
})
