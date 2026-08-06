import { describe, expect, it } from 'vitest'
import { splitByAnnotations } from './highlight'

describe('splitByAnnotations', () => {
  it('splits marked and unmarked runs', () => {
    expect(splitByAnnotations('hello world', [{ from: 6, id: 'a1', to: 11 }])).toEqual([
      { annId: null, text: 'hello ' },
      { annId: 'a1', text: 'world' },
    ])
  })

  it('lets the first annotation own overlap and preserves the later tail', () => {
    expect(splitByAnnotations('abcdef', [
      { from: 1, id: 'first', to: 4 },
      { from: 3, id: 'second', to: 6 },
    ])).toEqual([
      { annId: null, text: 'a' },
      { annId: 'first', text: 'bcd' },
      { annId: 'second', text: 'ef' },
    ])
  })

  it('clips invalid ranges and handles no annotations', () => {
    expect(splitByAnnotations('abc', [])).toEqual([{ annId: null, text: 'abc' }])
    expect(splitByAnnotations('abc', [{ from: -2, id: 'x', to: 9 }])).toEqual([
      { annId: 'x', text: 'abc' },
    ])
  })
})
