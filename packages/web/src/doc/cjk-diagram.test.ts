import { describe, expect, it } from 'vitest'
import { isCjkDiagram } from './cjk-diagram'
import { renderAnnotatedHtml, renderMarkdown } from './markdown'

describe('CJK diagram fences', () => {
  it('recognizes box drawing variants but leaves ordinary code and Chinese prose alone', () => {
    for (const char of ['┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '│', '─', '═', '║', '╿']) expect(isCjkDiagram(char)).toBe(true)
    for (const text of ['', '中文说明', 'const box = "a | b"', '+---+']) expect(isCjkDiagram(text)).toBe(false)
  })

  it('marks only matching fences and preserves code language and text', () => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown('```text\n┌─中文─┐\n```\n\n```ts\nconst n = 1\n```\n\n`│行内代码│`\n\n    │缩进代码│')
    const blocks = root.querySelectorAll('pre')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toHaveClass('is-cjk-diagram')
    expect(blocks[0].querySelector('code')).toHaveClass('language-text')
    expect(blocks[0].textContent).toBe('┌─中文─┐\n')
    expect(blocks[1]).not.toHaveClass('is-cjk-diagram')
    expect(blocks[2]).not.toHaveClass('is-cjk-diagram')
    expect(root.querySelector('p > code')).not.toHaveClass('is-cjk-diagram')
  })

  it('retains the fence class when annotation marks are added', () => {
    const root = document.createElement('div')
    root.innerHTML = renderAnnotatedHtml('```\n│中文│\n```', [{ id: 'a1', from: 1, to: 3 }])
    expect(root.querySelector('pre')).toHaveClass('is-cjk-diagram')
    expect(root.querySelector('mark')).toHaveTextContent('中文')
  })
})
