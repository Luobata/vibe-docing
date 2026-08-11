import { act, renderHook } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getColumnMaxWidth, useColumnResize } from './use-column-resize'

const originalInnerWidth = window.innerWidth

describe('useColumnResize', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  })
  afterAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth }))

  it('clamps left width to a minimum', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => { result.current.startDrag('left', 1000) })
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 })) }) // 拖到极窄
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    expect(result.current.leftWidth).toBeGreaterThanOrEqual(180)
  })

  it('persists width to localStorage', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => { result.current.resetSide('left') })
    expect(localStorage.getItem('workbench.cols')).not.toBeNull()
  })

  it('clamps each outer column against both gutters, the center minimum, and the opposite minimum', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => result.current.resizeSide('left', 2000))
    expect(result.current.leftWidth).toBe(getColumnMaxWidth('left'))
    expect(result.current.rightWidth).toBe(260)

    act(() => result.current.resizeSide('right', 2000))
    expect(result.current.rightWidth).toBe(getColumnMaxWidth('right'))
    expect(result.current.leftWidth).toBe(180)
  })

  it('fits oversized stored widths into the viewport on initialization', () => {
    localStorage.setItem('workbench.cols', JSON.stringify({ left: 900, right: 900 }))
    const { result } = renderHook(() => useColumnResize())
    expect(result.current.leftWidth + result.current.rightWidth).toBeLessThanOrEqual(1280 - 12 - 360)
  })

  it('re-fits desktop columns when the viewport becomes narrower', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => result.current.resizeSide('left', 500))
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.leftWidth + result.current.rightWidth).toBeLessThanOrEqual(1024 - 12 - 360)
  })
})
