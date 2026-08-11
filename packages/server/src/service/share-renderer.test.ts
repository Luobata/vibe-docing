import { plainTextToProseMirror, type NodeRow, type TreeRow, type VisualArtifact } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { renderShareHtml, renderShareMarkdown, visualReferenceKey, type ShareNode } from './share-renderer'

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
    expect(html).not.toContain('createdAt:')
    expect(html).not.toContain('branch:start')
  })

  it('renders a complete visual scene for AI and a safe static canvas for people', () => {
    const artifact: VisualArtifact = {
      artifactId: 'secret-artifact',
      revision: 3,
      schemaVersion: 1,
      kind: 'flow',
      title: '支付流程',
      altText: '购物车提交后经过支付再进入履约',
      renderer: 'canvas',
      nodes: [
        { id: 'cart', label: '购物车', description: '提交订单', groupId: 'order' },
        { id: 'pay', label: '支付', data: { owner: 'payment' } },
      ],
      edges: [{ id: 'submit', source: 'cart', target: 'pay', label: '提交', directed: true }],
      groups: [{ id: 'order', label: '下单域', nodeIds: ['cart'] }],
    }
    const response = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '正文之前' }] },
        { type: 'visual_ref', attrs: { artifactId: artifact.artifactId, revision: artifact.revision, altText: artifact.altText } },
        { type: 'paragraph', content: [{ type: 'text', text: '正文之后' }] },
      ],
    })
    const root: ShareNode = { row: { ...node('visual', null), ai_response: response }, children: [] }
    const document = { tree, root, visuals: new Map([[visualReferenceKey(artifact), artifact]]) }

    const output = renderShareMarkdown(document)
    expect(output.indexOf('正文之前')).toBeLessThan(output.indexOf('```visual-scene'))
    expect(output.indexOf('```visual-scene')).toBeLessThan(output.indexOf('正文之后'))
    expect(output).toContain('"title": "支付流程"')
    expect(output).toContain('"description": "提交订单"')
    expect(output).toContain('"source": "cart"')
    expect(output).toContain('"nodeIds": [')
    expect(output).not.toContain('secret-artifact')

    const html = renderShareHtml(document, '/share/t.md')
    expect(html).toContain('<figure class="share-visual"')
    expect(html).toContain('<svg role="img"')
    expect(html).toContain('data-node-count="2"')
    expect(html).toContain('data-edge-count="1"')
    expect(html).toContain('查看结构化数据')
    expect(html).toContain('支付流程')
    expect(html).not.toContain('visual-scene')
    expect(html).not.toContain('secret-artifact')
    expect(html).not.toContain('<script>')
  })

  it('keeps the visual alt text when an artifact is unavailable', () => {
    const altText = '完整的文字降级说明'
    const response = JSON.stringify({
      type: 'doc',
      content: [{ type: 'visual_ref', attrs: { artifactId: 'missing', revision: 1, altText } }],
    })
    const root: ShareNode = { row: { ...node('visual', null), ai_response: response }, children: [] }
    const output = renderShareMarkdown({ tree, root })
    expect(output).toContain(altText)
    expect(output).toContain('**可视化**')
    expect(output).not.toContain('missing')
    expect(output).not.toContain('visual-scene')
  })
})
