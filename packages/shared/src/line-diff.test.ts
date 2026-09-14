import { describe, expect, it } from 'vitest'
import { lineDiff } from './line-diff'

describe('lineDiff', () => {
  it('returns a stable line-level LCS diff', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { text: 'a', type: 'same' },
      { text: 'b', type: 'del' },
      { text: 'x', type: 'add' },
      { text: 'c', type: 'same' },
    ])
  })
})

it('preserves blank lines, trailing newlines, and deletion-first tie ordering', () => {
  expect(lineDiff('', '')).toEqual([{ type: 'same', text: '' }])
  expect(lineDiff('a\n', 'a')).toEqual([{ type: 'same', text: 'a' }, { type: 'del', text: '' }])
  expect(lineDiff('a\nb', 'b\na')).toEqual([{ type: 'del', text: 'a' }, { type: 'same', text: 'b' }, { type: 'add', text: 'a' }])
  expect(lineDiff('甲\n\n乙', '甲\n丙\n乙')).toEqual([
    { type: 'same', text: '甲' }, { type: 'del', text: '' }, { type: 'add', text: '丙' }, { type: 'same', text: '乙' },
  ])
})
