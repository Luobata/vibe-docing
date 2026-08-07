import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useColumnResize } from './use-column-resize'

describe('useColumnResize', () => {
  beforeEach(() => localStorage.clear())

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
})
