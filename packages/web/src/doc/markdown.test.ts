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

  it('renders a table even when rows are separated by blank lines', () => {
    // Some models emit tables double-spaced; blank lines between rows would
    // otherwise split the table into paragraphs of literal `| … |` text.
    const html = renderMarkdown(
      '| 新增一级属性 | 适用场景 |\n\n| --- | --- |\n\n| 协作关系属性 | 多Agent协同 |',
    )
    expect(html).toContain('<table>')
    expect(html).toContain('<td>协作关系属性</td>')
    expect(html).not.toContain('<p>| 协作关系属性')
  })

  it('renders a table when a paragraph sits directly above it with no blank line', () => {
    const html = renderMarkdown('常见可补充的一级属性如下：\n| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<p>常见可补充的一级属性如下：</p>')
  })

  it('renders a table that follows a blockquote line with no blank line (screenshot bug)', () => {
    // The real failure: `>` conditions text, then prose, then the table — all
    // contiguous. Blockquote lazy-continuation swallowed the header and the
    // pipes leaked as plain paragraphs.
    const src =
      '> ① 会直接影响核心决策 ② 会动态变化\n常见可补充的一级属性如下：\n| 新增一级属性 | 适用场景 |\n| --- | --- |\n| 协作关系属性 | 多Agent协同 |'
    const html = renderMarkdown(src)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>协作关系属性</td>')
    expect(html).not.toContain('新增一级属性 |')
  })

  it('keeps a blank line between a table and following prose', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n随后的正文段落。')
    expect(html).toContain('<table>')
    expect(html).toContain('<p>随后的正文段落。</p>')
  })

  it('renders a table wrapped in a blockquote with empty-quote separators', () => {
    // `>` marker on the separator lines: `.trim()` would leave "&gt;", so the
    // gap-collapsing must recognize empty blockquote lines as blank too.
    const html = renderMarkdown('> | A | B |\n>\n> | --- | --- |\n>\n> | 1 | 2 |')
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
