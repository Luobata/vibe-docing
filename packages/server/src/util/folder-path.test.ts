import { describe, expect, it } from 'vitest'
import { sanitizeTreeFolder } from './folder-path'

describe('sanitizeTreeFolder', () => {
  it.each([
    [' 工作/../周报 ', '工作/周报'],
    ['./a\\b//../c', 'a/b/c'],
    ['a/b/c/d/e/f/g', 'a/b/c/d/e/f'],
    [' 项目:<A>*?/报告#1 ', '项目A/报告1'],
    [' 团队_1/设计-文档/hello world ', '团队_1/设计-文档/hello world'],
    ['.././<>:*?/', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(sanitizeTreeFolder(input)).toBe(expected)
  })
})
