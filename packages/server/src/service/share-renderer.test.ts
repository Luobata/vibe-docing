import { plainTextToProseMirror, type NodeRow, type TreeRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { renderShareHtml, renderShareMarkdown, type ShareNode } from './share-renderer'

const tree: TreeRow = { id: 'secret-tree', title: 'Title <script>', root_node_id: 'n0', is_deleted: 0, created_at: '2026-01-01', updated_at: '2026-01-02' }
const node = (id: string, parent: string | null, text = ''): NodeRow => ({ id, tree_id: tree.id, parent_id: parent, sort_order: 0, user_input: plainTextToProseMirror(text), ai_response: plainTextToProseMirror('```ts\nconst x = 1\n```\n|a|b|'), status: 'complete', is_deleted: 0, model_override: 'secret-model', created_at: 'x', updated_at: 'x' })

describe('share renderer', () => {
  it('renders ordered deep branches without internal data and escapes html', () => {
    let root: ShareNode = { row: node('n7', 'n6', '# special <!--'), children: [] }
    for (let depth = 6; depth >= 0; depth--) root = { row: node(`n${depth}`, depth ? `n${depth - 1}` : null, `level ${depth}`), children: [root] }
    const markdown = renderShareMarkdown({ tree, root })
    expect(markdown.match(/^# /gm)).toHaveLength(1)
    expect(markdown).toContain('**Depth:** 7')
    expect(markdown).toContain('**Path:**')
    expect(markdown).toContain('branch:start')
    expect(markdown).not.toContain('secret-tree')
    expect(markdown).not.toContain('secret-model')
    const html = renderShareHtml({ tree, root }, '/share/t.md')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
