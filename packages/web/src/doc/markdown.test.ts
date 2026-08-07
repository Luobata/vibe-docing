import { describe, expect, it } from 'vitest'
import { renderAnnotatedHtml, renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings, bold, lists and tables', () => {
    const html = renderMarkdown('### 标题\n\n**加粗** 和普通\n\n- 一\n- 二')
    expect(html).toContain('<h3>标题</h3>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<li>一</li>')
  })

  it('renders a table', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('does not pass through raw inline HTML (no XSS injection)', () => {
    const html = renderMarkdown('普通 <img src=x onerror=alert(1)> 文本')
    expect(html).not.toContain('<img')
  })
})

describe('renderAnnotatedHtml', () => {
  // Visible text of "**内存**比磁盘快" is "内存比磁盘快"; annotate "比磁盘" (offset 2..5).
  it('wraps annotated visible-text range in a mark, across inline formatting', () => {
    const html = renderAnnotatedHtml('**内存**比磁盘快', [{ from: 2, id: 'a1', to: 5 }])
    const container = document.createElement('div')
    container.innerHTML = html
    const mark = container.querySelector('mark[data-ann-id="a1"]')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('比磁盘')
    // bold structure preserved
    expect(container.querySelector('strong')?.textContent).toBe('内存')
    // visible text unchanged overall (ignoring markdown-it's structural newlines)
    expect(container.textContent?.trim()).toBe('内存比磁盘快')
  })

  it('returns plain rendered html when there are no annotations', () => {
    const html = renderAnnotatedHtml('### 标题', [])
    expect(html).toContain('<h3>标题</h3>')
    expect(html).not.toContain('data-ann-id')
  })
})
