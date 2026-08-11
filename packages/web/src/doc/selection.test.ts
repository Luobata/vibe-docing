import { afterEach, describe, expect, it } from 'vitest'
import { getPlainSelection } from './selection'

describe('getPlainSelection', () => {
  afterEach(() => {
    document.body.replaceChildren()
    window.getSelection()?.removeAllRanges()
  })

  it('returns null without an in-container selection', () => {
    const container = document.createElement('div')
    container.textContent = 'hello'
    document.body.append(container)

    expect(getPlainSelection(container)).toBeNull()
  })

  it('computes plain-text offsets from a jsdom Range', () => {
    const container = document.createElement('div')
    container.textContent = 'hello world'
    document.body.append(container)
    const range = document.createRange()
    range.setStart(container.firstChild!, 6)
    range.setEnd(container.firstChild!, 11)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getPlainSelection(container)).toEqual({ from: 6, text: 'world', to: 11 })
  })

  it('uses DOM text-node offsets across blocks instead of Range.toString block separators', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>前文结论</p>\n<p><strong>MemoryScope</strong> 增加 roleId</p>'
    document.body.append(container)
    const selected = container.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.setStart(selected, 0)
    range.setEnd(selected, 'MemoryScope'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getPlainSelection(container)).toEqual({
      from: '前文结论\n'.length,
      text: 'MemoryScope',
      to: '前文结论\nMemoryScope'.length,
    })
  })
})
