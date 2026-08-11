import MarkdownIt from 'markdown-it'
import { prosemirrorToPlainText, type NodeRow, type TreeRow } from '@vibe/shared'

export interface ShareDocument {
  tree: TreeRow
  root: ShareNode
}

export interface ShareNode {
  row: NodeRow
  children: ShareNode[]
}

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })

function safeLine(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/^([#>])/gm, '\\$1').replace(/<!--/g, '&lt;!--')
}

function label(node: NodeRow): string {
  const input = prosemirrorToPlainText(node.user_input).trim()
  return safeLine(input.split('\n')[0]?.slice(0, 100) || (node.parent_id ? '未命名分支' : '主文档'))
}

function body(node: NodeRow): string {
  const parts: string[] = []
  const input = prosemirrorToPlainText(node.user_input).trim()
  const answer = prosemirrorToPlainText(node.ai_response).trim()
  if (input) parts.push(`**提问**\n\n${safeLine(input)}`)
  if (answer) parts.push(`**回答**\n\n${safeLine(answer)}`)
  return parts.join('\n\n')
}

export function renderShareMarkdown(document: ShareDocument): string {
  const out = [
    '---',
    `title: ${JSON.stringify(document.tree.title)}`,
    `createdAt: ${JSON.stringify(document.tree.created_at)}`,
    `updatedAt: ${JSON.stringify(document.tree.updated_at)}`,
    '---',
    '',
    `# ${safeLine(document.tree.title)}`,
  ]

  function visit(node: ShareNode, depth: number, path: string[]): void {
    const name = label(node.row)
    const nextPath = [...path, name]
    const headingDepth = Math.min(depth + 2, 6)
    out.push('', `<!-- branch:start depth=${depth} -->`, '', `${'#'.repeat(headingDepth)} ${name}`)
    if (depth > 6) out.push('', `**Depth:** ${depth}`, '', `**Path:** ${nextPath.join(' / ')}`)
    const content = body(node.row)
    if (content) out.push('', content)
    for (const child of node.children) visit(child, depth + 1, nextPath)
    out.push('', '<!-- branch:end -->')
  }

  visit(document.root, 0, [])
  return `${out.join('\n').trim()}\n`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderShareHtml(document: ShareDocument, markdownUrl: string): string {
  const source = renderShareMarkdown(document)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(document.tree.title)}</title><link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}"><style>html{font:16px/1.7 system-ui,sans-serif;color:#1f2328;background:#fff}body{max-width:860px;margin:0 auto;padding:48px 24px;overflow-wrap:anywhere}pre,table{max-width:100%;overflow:auto}img{max-width:100%}h1{font-size:2rem;border-bottom:1px solid #d0d7de;padding-bottom:.4em}h2,h3,h4,h5,h6{margin-top:1.8em}</style></head><body>${markdown.render(source)}</body></html>`
}
