import type { NodeRow } from '@vibe/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { DocumentEditor, type DocumentEditorHandle } from './DocumentEditor'

beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 1, 1)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rect()] })
  Object.defineProperty(window, 'scrollBy', { configurable: true, value: vi.fn() })
})

function documentNode(patch: Partial<NodeRow> = {}): NodeRow {
  return {
    ai_response: '# 可编辑正文\n\n> [!note]\n> 原样保留\n',
    content_hash: 'hash-4',
    content_revision: 4,
    content_schema_version: 2,
    content_updated_at: '2026-08-12T00:00:00.000Z',
    created_at: '2026-08-12T00:00:00.000Z',
    file_kind: 'markdown',
    file_path: 'Notes/可编辑正文.md',
    id: 'node-1',
    is_deleted: 0,
    model_override: null,
    parent_id: null,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree-1',
    updated_at: '2026-08-12T00:00:00.000Z',
    user_input: '一份笔记',
    vault_root: '/vault',
    ...patch,
  }
}

describe('DocumentEditor', () => {
  it('saves native Markdown without converting it to editor JSON', async () => {
    const node = documentNode()
    const saveDocumentContent = vi.fn(async (_id: string, body: { source: string }) => ({
      content: { fileKind: 'markdown' as const, nodeId: node.id, revision: 5, schemaVersion: 2 as const, source: body.source, updatedAt: null },
      node: { ...node, ai_response: body.source, content_revision: 5 },
    }))
    const ref = createRef<DocumentEditorHandle>()
    render(
      <ApiProvider api={{ saveDocumentContent } as never}>
        <DocumentEditor annotations={[]} node={node} onSaved={() => {}} onSelect={() => {}} ref={ref} />
      </ApiProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '粗体' }))
    await act(async () => { await ref.current?.flush() })

    expect(saveDocumentContent).toHaveBeenCalledWith(node.id, expect.objectContaining({
      baseRevision: 4,
      fileKind: 'markdown',
      schemaVersion: 2,
      source: expect.stringContaining('> [!note]'),
    }))
    expect(saveDocumentContent.mock.calls[0][1].source).not.toContain('"type":"doc"')
  })

  it('switches between Markdown editing and reading preview', () => {
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode()} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )
    expect(screen.getByLabelText('Markdown 源码')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    expect(screen.getByRole('heading', { name: '可编辑正文' })).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.tagName === 'BLOCKQUOTE' && element.textContent?.includes('原样保留') === true)).toBeInTheDocument()
  })

  it('opens an empty note in edit mode with novice formatting tools', () => {
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({ ai_response: '', content_schema_version: 0, document_content: '' })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )

    expect(screen.getByLabelText('Markdown 源码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一级标题' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '无序列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '任务列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '普通链接' })).toBeInTheDocument()
  })

  it('loads the disk version after an optimistic conflict', async () => {
    const local = documentNode()
    const disk = documentNode({ ai_response: '# 磁盘版本', content_revision: 6 })
    const saveDocumentContent = vi.fn(async () => { throw new ApiError(409, { error: 'content conflict' }) })
    const getNode = vi.fn(async () => ({ annotations: [], node: disk, segments: [] }))
    const ref = createRef<DocumentEditorHandle>()
    render(
      <ApiProvider api={{ getNode, saveDocumentContent } as never}>
        <DocumentEditor annotations={[]} node={local} onSaved={() => {}} onSelect={() => {}} ref={ref} />
      </ApiProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '粗体' }))
    await act(async () => { try { await ref.current?.flush() } catch {} })
    fireEvent.click(screen.getByRole('button', { name: '加载磁盘版本' }))
    await waitFor(() => expect(getNode).toHaveBeenCalledWith(local.id))
    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    expect(await screen.findByRole('heading', { name: '磁盘版本' })).toBeInTheDocument()
  })

  it('uses keepalive when the window is about to close', async () => {
    const node = documentNode()
    const saveDocumentContent = vi.fn(async (_id: string, body: { source: string }) => ({
      content: { nodeId: node.id, revision: 5, schemaVersion: 2 as const, source: body.source, updatedAt: null },
      node: { ...node, content_revision: 5 },
    }))
    render(
      <ApiProvider api={{ saveDocumentContent } as never}>
        <DocumentEditor annotations={[]} node={node} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '粗体' }))
    await act(async () => { window.dispatchEvent(new Event('beforeunload')) })
    await waitFor(() => expect(saveDocumentContent).toHaveBeenCalledWith(
      node.id,
      expect.objectContaining({ schemaVersion: 2 }),
      { keepalive: true },
    ))
  })

  it('edits standard JSON Canvas nodes and persists the open format', async () => {
    const node = documentNode({
      ai_response: '{\n  "nodes": [],\n  "edges": []\n}\n',
      file_kind: 'canvas',
      file_path: 'Boards/Ideas.canvas',
    })
    const saveDocumentContent = vi.fn(async (_id: string, body: { source: string }) => ({
      content: { fileKind: 'canvas' as const, nodeId: node.id, revision: 5, schemaVersion: 2 as const, source: body.source, updatedAt: null },
      node: { ...node, ai_response: body.source, content_revision: 5 },
    }))
    const ref = createRef<DocumentEditorHandle>()
    render(
      <ApiProvider api={{ saveDocumentContent } as never}>
        <DocumentEditor annotations={[]} node={node} onSaved={() => {}} onSelect={() => {}} ref={ref} />
      </ApiProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    expect(screen.getAllByText('新文本卡片')).not.toHaveLength(0)
    await act(async () => { await ref.current?.flush() })
    expect(saveDocumentContent).toHaveBeenCalledWith(node.id, expect.objectContaining({
      fileKind: 'canvas',
      source: expect.stringContaining('"type": "text"'),
    }))
  })

  it('renders Canvas from canonical document_content and lets users dismiss its inspector', () => {
    const source = JSON.stringify({
      edges: [],
      nodes: [{ height: 180, id: 'canonical', text: '# 从文件读取', type: 'text', width: 280, x: 80, y: 80 }],
    })
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({
            ai_response: '{"nodes":[],"edges":[]}',
            document_content: source,
            file_kind: 'canvas',
            file_path: 'Boards/Canonical.canvas',
          })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )

    const card = screen.getByLabelText(/^文本卡片：# 从文件读取$/)
    expect(card).toBeVisible()
    fireEvent.click(card)
    expect(screen.getByLabelText('Canvas 检查器')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭属性面板' }))
    expect(screen.queryByLabelText('Canvas 检查器')).toBeNull()
  })

  it('explains an empty Canvas and closes a selection with Escape', () => {
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({ ai_response: '{"nodes":[],"edges":[]}', file_kind: 'canvas' })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )

    expect(screen.getByText('这块画布还是空的')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    expect(screen.getByLabelText('Canvas 检查器')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText('Canvas 画布区域'), { key: 'Escape' })
    expect(screen.queryByLabelText('Canvas 检查器')).toBeNull()
  })

  it('arranges overlapping Canvas cards and explains how to connect two cards', () => {
    const source = JSON.stringify({
      edges: [],
      nodes: [
        { height: 300, id: 'group', label: '规划区', type: 'group', width: 420, x: 80, y: 80 },
        { height: 180, id: 'first', text: '起点', type: 'text', width: 280, x: 100, y: 100 },
        { height: 180, id: 'second', text: '结论', type: 'text', width: 280, x: 120, y: 120 },
      ],
    })
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({ document_content: source, file_kind: 'canvas' })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '整理画布' }))
    const group = screen.getByLabelText('分组：规划区')
    const first = screen.getByLabelText('文本卡片：起点')
    const second = screen.getByLabelText('文本卡片：结论')
    expect(group).not.toHaveStyle({ left: first.style.left, top: first.style.top })
    expect(first.style.top).not.toBe(second.style.top)
    expect(screen.getByRole('status')).toHaveTextContent('卡片内容和连接保持不变')

    fireEvent.click(first)
    expect(screen.getByRole('status')).toHaveTextContent('按住 Shift 再选一个')
    fireEvent.click(second, { shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('已选 2 个卡片')
    fireEvent.click(screen.getByRole('button', { name: '连接所选' }))
    expect(screen.getByRole('status')).toHaveTextContent('连接已建立')
  })

  it('moves selected Canvas cards with the keyboard', () => {
    const source = JSON.stringify({
      edges: [],
      nodes: [{ height: 180, id: 'first', text: '键盘移动', type: 'text', width: 280, x: 80, y: 80 }],
    })
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode({ document_content: source, file_kind: 'canvas' })} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )

    const card = screen.getByLabelText('文本卡片：键盘移动')
    const before = card.style.left
    fireEvent.click(card)
    fireEvent.keyDown(screen.getByLabelText('Canvas 画布区域'), { key: 'ArrowRight' })
    expect(card.style.left).not.toBe(before)
    expect(screen.getByRole('status')).toHaveTextContent('按住 Shift 可快速移动')
  })

  it('blocks unsafe Canvas links and explains supported schemes', () => {
    const source = JSON.stringify({
      edges: [],
      nodes: [{ height: 180, id: 'unsafe', type: 'link', url: 'javascript:alert(1)', width: 280, x: 80, y: 80 }],
    })
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode({ document_content: source, file_kind: 'canvas' })} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )

    fireEvent.click(screen.getByLabelText('链接卡片：javascript:alert(1)'))
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持 http、https 或 mailto')
    expect(screen.queryByRole('link', { name: '打开链接 ↗' })).toBeNull()
  })

  it('opens safe link cards directly and opens matching file cards in the notebook', () => {
    const target = documentNode({ id: 'target', file_path: 'Notes/Target.md' })
    const canvasDocument = documentNode({
      document_content: JSON.stringify({
        edges: [],
        nodes: [
          { file: 'Notes/Target.md', height: 180, id: 'file', type: 'file', width: 280, x: 80, y: 80 },
          { height: 180, id: 'link', type: 'link', url: 'https://example.com/guide', width: 280, x: 400, y: 80 },
        ],
      }),
      file_kind: 'canvas',
      id: 'canvas-note',
      parent_id: 'target',
    })
    useWorkbench.getState().reset()
    useWorkbench.getState().loadTree({ nodes: [target, canvasDocument], rootNodeId: target.id, treeId: 'tree-1' })
    useWorkbench.getState().setMain(canvasDocument.id)
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={canvasDocument} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )

    const link = screen.getByRole('link', { name: 'https://example.com/guide' })
    expect(link).toHaveAttribute('href', 'https://example.com/guide')
    expect(link).toHaveAttribute('target', '_blank')
    fireEvent.click(screen.getByRole('button', { name: 'Notes/Target.md' }))
    expect(useWorkbench.getState().mainNodeId).toBe('target')
    useWorkbench.getState().reset()
  })

  it('undoes Canvas deletion and blocks keyboard deletion while generating', () => {
    const source = JSON.stringify({
      edges: [],
      nodes: [{ height: 180, id: 'keep', text: '不要误删', type: 'text', width: 280, x: 80, y: 80 }],
    })
    const { rerender } = render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode({ document_content: source, file_kind: 'canvas' })} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )
    fireEvent.click(screen.getByLabelText('文本卡片：不要误删'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByLabelText('文本卡片：不要误删')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('文本卡片：不要误删')).toBeInTheDocument()

    rerender(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode({ document_content: source, file_kind: 'canvas', status: 'streaming' })} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )
    fireEvent.click(screen.getByLabelText('文本卡片：不要误删'))
    fireEvent.keyDown(screen.getByLabelText('Canvas 画布区域'), { key: 'Delete' })
    expect(screen.getByLabelText('文本卡片：不要误删')).toBeInTheDocument()
  })

  it('falls back to JSON source when a canvas is malformed', () => {
    render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({ ai_response: '{broken', file_kind: 'canvas', file_path: 'Broken.canvas' })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )
    expect(screen.getByLabelText('JSON Canvas 源码')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('JSON Canvas 结构无效')
  })
})

describe('DocumentEditor CodeMirror Notion 主题', () => {
  it('edits markdown without lineNumbers/foldGutter/activeLine chrome', () => {
    const { container } = render(
      <ApiProvider api={{} as never}>
        <DocumentEditor annotations={[]} node={documentNode()} onSaved={() => {}} onSelect={() => {}} />
      </ApiProvider>,
    )
    // 编辑态 CodeMirror 已挂载，且无 IDE 式行号/折叠栏 DOM。
    expect(container.querySelector('.cm-editor')).not.toBeNull()
    expect(container.querySelector('.cm-lineNumbers')).toBeNull()
    expect(container.querySelector('.cm-foldGutter')).toBeNull()
  })
})

describe('DocumentEditor 围栏代码行装饰', () => {
  it('marks ``` fenced lines with cm-code-line and leaves prose lines plain', () => {
    const { container } = render(
      <ApiProvider api={{} as never}>
        <DocumentEditor
          annotations={[]}
          node={documentNode({ ai_response: '前文\n\n```ts\nconst a = 1\nconst b = 2\n```\n\n后文' })}
          onSaved={() => {}}
          onSelect={() => {}}
        />
      </ApiProvider>,
    )
    const codeLines = container.querySelectorAll('.cm-code-line')
    expect(codeLines.length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.cm-code-line.cm-code-fence')).toHaveLength(2)
    const allLines = Array.from(container.querySelectorAll('.cm-line'))
    expect(allLines.length).toBeGreaterThan(codeLines.length)
    expect(allLines.some((el) => !el.classList.contains('cm-code-line'))).toBe(true)
  })
})

describe('预览代码块样式规则（Notion 化）', () => {
  const css = readFileSync(join(process.cwd(), 'src/components/Workbench.css'), 'utf8')
  function ruleOf(selector: string): string {
    const index = css.indexOf(selector)
    expect(index, `rule ${selector}`).toBeGreaterThanOrEqual(0)
    return css.slice(index, css.indexOf('}', index) + 1)
  }

  it('uses warm-paper background without borders for pre and inline code', () => {
    expect(css).toContain('--code-bg: #F7F6F3')
    expect(css).toContain('--code-ink: #EB5757')

    const pre = ruleOf('.doc-body pre {')
    expect(pre).toContain('background: var(--code-bg)')
    expect(pre).toContain('border: 0')
    expect(pre).toContain('border-radius: var(--r2)')

    const inline = ruleOf('.doc-body code {')
    expect(inline).toContain('color: var(--code-ink)')
    expect(inline).toContain('background: rgba(135, 131, 120, .15)')
    expect(inline).toContain('border: 0')

    const fence = ruleOf('.document-editor-surface .cm-code-line {')
    expect(fence).toContain('font-family: var(--mono)')
    expect(fence).toContain('background: var(--code-bg)')
  })
})
