import { describe, expect, it } from 'vitest'
import { normalizeMarkdown, normalizeTables } from './markdown-normalize'

describe('normalizeTables', () => {
  it('joins loose rows and starts a table after adjacent prose', () => {
    const source = '表格如下：\n| A | B |\n\n| --- | --- |\n\n| 1 | 2 |'
    expect(normalizeTables(source)).toBe('表格如下：\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('leaves unrelated blank lines byte-identical', () => {
    const source = '段落一\n\n段落二\n\n- 一\n- 二'
    expect(normalizeTables(source)).toBe(source)
  })
})

describe('normalizeMarkdown', () => {
  it('applies fenced-code and table normalization through one pipeline', () => {
    const source = [
      '```txt',
      'a',
      '',
      'b',
      '',
      'c',
      '',
      'd',
      '```',
      '表格如下：',
      '| A | B |',
      '',
      '| --- | --- |',
      '',
      '| 1 | 2 |',
    ].join('\n')

    expect(normalizeMarkdown(source)).toBe([
      '```txt',
      'a',
      'b',
      'c',
      'd',
      '```',
      '表格如下：',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n'))
  })
})
