import { describe, expect, it } from 'vitest'
import { lineDiff } from './diff'

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
