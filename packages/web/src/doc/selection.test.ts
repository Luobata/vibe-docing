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
})
