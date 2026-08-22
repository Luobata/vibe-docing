import { describe, expect, it } from 'vitest'
import { normalizeFencedCodeBlocks } from './code-fence'

describe('normalizeFencedCodeBlocks', () => {
  it('strips pathological blank lines interleaved between every code line', () => {
    const source = '## 一\n\n```\n\n用户自然语言输入\n\n      │\n\n      ▼\n\n┌────┐\n\n└────┘\n```\n\n正文'
    const out = normalizeFencedCodeBlocks(source)
    expect(out).toBe('## 一\n\n```\n用户自然语言输入\n      │\n      ▼\n┌────┐\n└────┘\n```\n\n正文')
  })

  it('keeps normal code blocks byte-identical', () => {
    const source = '```js\nconst a = 1\n\nconst b = 2\n\n\nconst c = 3\n```'
    expect(normalizeFencedCodeBlocks(source)).toBe(source)
  })

  it('keeps single intentional blank lines in sparse code', () => {
    const source = '```\nstep1\n\nstep2\nstep3\n```'
    expect(normalizeFencedCodeBlocks(source)).toBe(source)
  })

  it('leaves prose and fences outside untouched', () => {
    const source = '段落一\n\n段落二\n\n```\ncode\n```\n\n段落三'
    expect(normalizeFencedCodeBlocks(source)).toBe(source)
  })

  it('normalizes an unclosed fence at end of document', () => {
    const source = '```\n\na\n\nb\n\nc\n\n'
    expect(normalizeFencedCodeBlocks(source)).toBe('```\na\nb\nc')
  })

  it('handles fence with language tag', () => {
    const source = '```python\n\nx = 1\n\ny = 2\n\nz = 3\n\n```'
    expect(normalizeFencedCodeBlocks(source)).toBe('```python\nx = 1\ny = 2\nz = 3\n```')
  })

  it('keeps two-content-line fences untouched (too small to judge)', () => {
    const source = '```\na\n\nb\n```'
    expect(normalizeFencedCodeBlocks(source)).toBe(source)
  })
})
