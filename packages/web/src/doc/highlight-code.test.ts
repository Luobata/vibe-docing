import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from './markdown'
import { attachCopyHandler, enhanceCodeBlocks } from './highlight-code'

function codeFixture(fence: string): { container: HTMLElement; code: HTMLElement; pre: HTMLElement } {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(fence)
  const pre = container.querySelector('pre') as HTMLElement
  const code = pre.querySelector('code') as HTMLElement
  return { container, code, pre }
}

function mockClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return writeText
}

afterEach(() => {
  vi.useRealTimers()
})

describe('enhanceCodeBlocks', () => {
  it('injects a copy button into every code block, known or unknown language', () => {
    const { container } = codeFixture('```ts\nconst a = 1\n```\n\n```foobar\nweird stuff\n```')
    enhanceCodeBlocks(container)
    const buttons = container.querySelectorAll('pre > button[data-code-copy]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('复制')
    expect(buttons[0].getAttribute('aria-label')).toBe('复制代码')
  })

  it('degrades unknown languages to plain text without errors', async () => {
    const { container, code } = codeFixture('```foobar\nconst plain = true\n```')
    enhanceCodeBlocks(container)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(code.innerHTML).not.toContain('<span')
    expect(code.textContent).toBe('const plain = true\n')
  })

  it('degrades fences without a language tag and empty fences', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown('```\nno language\n```\n\n```\n```')
    enhanceCodeBlocks(container)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const codes = container.querySelectorAll('pre > code')
    expect(codes[0].innerHTML).not.toContain('<span')
    expect(codes[1].textContent).toBe('')
  })

  it('highlights known languages asynchronously and preserves the raw text', async () => {
    const { container, code } = codeFixture('```ts\nconst answer: number = 42\n```')
    enhanceCodeBlocks(container)
    expect(code.innerHTML).not.toContain('<span') // 先纯文本，异步替换
    await vi.waitFor(() => expect(code.innerHTML).toContain('<span'), { timeout: 5000 })
    // 着色只改标记不改文本：textContent 即原始源码
    expect(code.textContent).toBe('const answer: number = 42\n')
  })

  it('applies cached highlights synchronously on later passes', async () => {
    const { container, code } = codeFixture('```js\nconst cacheProbe = 7\n```')
    enhanceCodeBlocks(container)
    await vi.waitFor(() => expect(code.innerHTML).toContain('<span'), { timeout: 5000 })
    const plain = code.innerHTML
    code.innerHTML = renderMarkdown('```js\nconst cacheProbe = 7\n```').match(/<code[^>]*>([\s\S]*?)<\/code>/)?.[1] ?? ''
    expect(code.innerHTML).not.toContain('<span')
    enhanceCodeBlocks(container)
    expect(code.innerHTML).toContain('<span') // 同步命中，无 await
    expect(code.innerHTML).not.toBe(plain + '-unchanged') // sanity
  })

  it('skips highlighting code blocks that carry annotation marks, but keeps the button', async () => {
    const { container, code, pre } = codeFixture('```ts\nconst guarded = 1\n```')
    code.innerHTML = '<mark data-ann-id="a1">const</mark> guarded = 1\n'
    enhanceCodeBlocks(container)
    expect(pre.querySelector('button[data-code-copy]')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(code.querySelector('span')).toBeNull()
    expect(code.querySelector('mark')).not.toBeNull()
  })
})

describe('attachCopyHandler', () => {
  it('copies the raw source (no highlight markup) and shows feedback', async () => {
    const writeText = mockClipboard()
    const { container, code, pre } = codeFixture('```python\ndef hello():\n    return "hi"\n```')
    enhanceCodeBlocks(container)
    // 先用真实定时器等异步高亮落位（fake timers 会卡住 vi.waitFor）
    await vi.waitFor(() => expect(code.innerHTML).toContain('<span'), { timeout: 5000 })
    vi.useFakeTimers()
    const detach = attachCopyHandler(container)
    try {
      fireEvent.click(pre.querySelector('button[data-code-copy]') as HTMLElement)
      await vi.advanceTimersByTimeAsync(0)
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(writeText).toHaveBeenCalledWith('def hello():\n    return "hi"\n')
      const button = pre.querySelector('button[data-code-copy]') as HTMLElement
      expect(button.textContent).toBe('已复制')
      await vi.advanceTimersByTimeAsync(2000)
      expect(button.textContent).toBe('复制')
    } finally {
      detach()
      vi.useRealTimers()
    }
  })

  it('stays silent when the clipboard write fails', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const { container, pre } = codeFixture('```go\npackage main\n```')
    enhanceCodeBlocks(container)
    const detach = attachCopyHandler(container)
    try {
      fireEvent.click(pre.querySelector('button[data-code-copy]') as HTMLElement)
      await vi.advanceTimersByTimeAsync(10)
      expect(pre.querySelector('button[data-code-copy]')?.textContent).toBe('复制')
    } finally {
      detach()
    }
  })

  it('stops handling clicks after detach', () => {
    const writeText = mockClipboard()
    const { container, pre } = codeFixture('```sql\nSELECT 1;\n```')
    enhanceCodeBlocks(container)
    const detach = attachCopyHandler(container)
    detach()
    fireEvent.click(pre.querySelector('button[data-code-copy]') as HTMLElement)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('is idempotent per container: a second attach returns the same detach', () => {
    const { container } = codeFixture('```css\n.a { color: red }\n```')
    const first = attachCopyHandler(container)
    const second = attachCopyHandler(container)
    expect(first).toBe(second)
    first()
  })
})

describe('useCodeEnhancements wiring (via DocView is covered in DocView.test)', () => {
  it('re-running enhance after a simulated streaming re-render keeps buttons present', () => {
    const { container, code } = codeFixture('```ts\nconst streamed = 1\n```')
    enhanceCodeBlocks(container)
    // 模拟流式重渲染：innerHTML 被替换为纯文本（按钮丢失），再跑一轮增强
    code.parentElement!.querySelector('button[data-code-copy]')?.remove()
    enhanceCodeBlocks(container)
    expect(container.querySelector('pre > button[data-code-copy]')).not.toBeNull()
  })

  it('render helper sanity: markdown fences render into pre>code.language-*', () => {
    const { code } = codeFixture('```yaml\nkey: value\n```')
    expect(code.className).toBe('language-yaml')
  })
})
