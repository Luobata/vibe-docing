import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePastedImages } from './use-pasted-images'

function imgFile(name = 'a.png') { return new File([new Uint8Array([1])], name, { type: 'image/png' }) }
function txtFile() { return new File(['x'], 't.txt', { type: 'text/plain' }) }

describe('usePastedImages', () => {
  beforeEach(() => { globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn() })
  it('adds only image files', () => {
    const { result } = renderHook(() => usePastedImages())
    act(() => result.current.addFiles([imgFile(), txtFile()]))
    expect(result.current.images).toHaveLength(1)
  })
  it('removes and clears, revoking urls', () => {
    const { result } = renderHook(() => usePastedImages())
    act(() => result.current.addFiles([imgFile(), imgFile('b.png')]))
    const id = result.current.images[0].id
    act(() => result.current.removeImage(id))
    expect(result.current.images).toHaveLength(1)
    act(() => result.current.clear())
    expect(result.current.images).toHaveLength(0)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()
  })
})
