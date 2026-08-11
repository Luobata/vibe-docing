import MarkdownIt from 'markdown-it'
import {
  prosemirrorToPlainText,
  prosemirrorToRenderRuns,
  sceneLayout,
  validateVisualArtifact,
  validateVisualScene,
  type NodeRow,
  type TreeRow,
  type VisualArtifact,
  type VisualReference,
  type VisualScene,
} from '@vibe/shared'

export interface ShareDocument {
  tree: TreeRow
  root: ShareNode
  visuals?: ReadonlyMap<string, VisualArtifact>
}

export interface ShareNode {
  row: NodeRow
  children: ShareNode[]
}

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })

function safeLine(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/^([#>])/gm, '\\$1').replace(/<!--/g, '&lt;!--')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function visualReferenceKey(reference: Pick<VisualReference, 'artifactId' | 'revision'>): string {
  return JSON.stringify([reference.artifactId, reference.revision])
}

function publicScene(artifact: VisualArtifact): VisualScene {
  return {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    title: artifact.title,
    altText: artifact.altText,
    renderer: artifact.renderer,
    nodes: artifact.nodes,
    edges: artifact.edges,
    groups: artifact.groups,
  }
}

function artifactFor(document: ShareDocument, reference: VisualReference): VisualArtifact | undefined {
  const candidate = document.visuals?.get(visualReferenceKey(reference))
  if (!candidate || candidate.artifactId !== reference.artifactId || candidate.revision !== reference.revision) return undefined
  const checked = validateVisualArtifact(candidate)
  return checked.success ? checked.value : undefined
}

function visualSceneMarkdown(scene: VisualScene): string {
  const source = JSON.stringify(scene, null, 2)
  const longestRun = Math.max(0, ...(source.match(/`+/g) ?? []).map((value) => value.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}visual-scene\n${source}\n${fence}`
}

function proseMirrorMarkdown(document: ShareDocument, source: string | null): string {
  const blocks = prosemirrorToRenderRuns(source).flatMap((run) => {
    if (run.type === 'text') {
      const text = safeLine(run.text).trim()
      return text ? [text] : []
    }
    const artifact = artifactFor(document, run.reference)
    return artifact
      ? [visualSceneMarkdown(publicScene(artifact))]
      : [`**可视化**\n\n${safeLine(run.reference.altText)}`]
  })
  return blocks.join('\n\n')
}

function rawLabel(node: NodeRow): string {
  const input = prosemirrorToPlainText(node.user_input).trim()
  return input.split('\n')[0]?.slice(0, 100) || (node.parent_id ? '未命名分支' : '主文档')
}

function label(node: NodeRow): string {
  return safeLine(rawLabel(node))
}

function shareTitle(document: ShareDocument): string {
  return document.root.row.id === document.tree.root_node_id
    ? document.tree.title
    : `${document.tree.title} · ${rawLabel(document.root.row)}`
}

function body(document: ShareDocument, node: NodeRow): string {
  const parts: string[] = []
  const input = proseMirrorMarkdown(document, node.user_input)
  const answer = proseMirrorMarkdown(document, node.ai_response)
  if (input) parts.push(`**提问**\n\n${input}`)
  if (answer) parts.push(`**回答**\n\n${answer}`)
  return parts.join('\n\n')
}

export function renderShareMarkdown(document: ShareDocument): string {
  const title = shareTitle(document)
  const out = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `createdAt: ${JSON.stringify(document.root.row.created_at)}`,
    `updatedAt: ${JSON.stringify(document.root.row.updated_at)}`,
    '---',
    '',
    `# ${safeLine(title)}`,
  ]

  function visit(node: ShareNode, depth: number, path: string[]): void {
    const name = label(node.row)
    const nextPath = [...path, name]
    const headingDepth = Math.min(depth + 2, 6)
    out.push('', `<!-- branch:start depth=${depth} -->`, '', `${'#'.repeat(headingDepth)} ${name}`)
    if (depth > 6) out.push('', `**Depth:** ${depth}`, '', `**Path:** ${nextPath.join(' / ')}`)
    const content = body(document, node.row)
    if (content) out.push('', content)
    for (const child of node.children) visit(child, depth + 1, nextPath)
    out.push('', '<!-- branch:end -->')
  }

  visit(document.root, 0, [])
  return `${out.join('\n').trim()}\n`
}

function midpoint(path: string): { x: number; y: number } | undefined {
  const match = path.match(/^M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)$/)
  return match ? { x: (+match[1] + +match[3]) / 2, y: (+match[2] + +match[4]) / 2 } : undefined
}

function renderVisualHtml(scene: VisualScene): string {
  const layout = sceneLayout(scene)
  const box = layout.viewBox
  const groups = layout.groups.map((group) =>
    `<g><rect class="share-visual-group" x="${group.rect.x}" y="${group.rect.y}" width="${group.rect.width}" height="${group.rect.height}"/><text x="${group.rect.x + 8}" y="${group.rect.y + 18}">${escapeHtml(group.label)}</text></g>`).join('')
  const edges = layout.edges.map((edge) => {
    const center = midpoint(edge.path)
    const edgeLabel = edge.label && center
      ? `<text class="share-visual-edge-label" text-anchor="middle" x="${center.x}" y="${center.y - 6}">${escapeHtml(edge.label)}</text>`
      : ''
    return `<g><path class="share-visual-edge" d="${edge.path}"/>${edgeLabel}</g>`
  }).join('')
  const nodes = layout.nodes.map((node) =>
    `<g><rect class="share-visual-node" x="${node.rect.x}" y="${node.rect.y}" width="${node.rect.width}" height="${node.rect.height}" rx="8" ry="8"/><text dominant-baseline="middle" text-anchor="middle" x="${node.rect.x + node.rect.width / 2}" y="${node.rect.y + node.rect.height / 2}">${escapeHtml(node.label)}</text></g>`).join('')
  const data = escapeHtml(JSON.stringify(scene, null, 2))
  return `<figure class="share-visual" aria-label="${escapeHtml(scene.altText)}"><div class="share-visual-viewport"><svg role="img" aria-label="${escapeHtml(scene.altText)}" data-edge-count="${layout.edges.length}" data-group-count="${layout.groups.length}" data-node-count="${layout.nodes.length}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"><title>${escapeHtml(scene.title)}</title>${groups}${edges}${nodes}</svg></div><figcaption><strong>${escapeHtml(scene.title)}</strong><span>${escapeHtml(scene.altText)}</span></figcaption><details class="share-visual-data"><summary>查看结构化数据</summary><pre><code>${data}</code></pre></details></figure>`
}

const defaultFence = markdown.renderer.rules.fence
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  if (token.info.trim() === 'visual-scene') {
    try {
      const checked = validateVisualScene(JSON.parse(token.content))
      if (checked.success) return renderVisualHtml(checked.value)
    } catch {
      // Invalid public payloads remain inert code blocks.
    }
  }
  return defaultFence
    ? defaultFence(tokens, index, options, env, self)
    : `<pre><code>${escapeHtml(token.content)}</code></pre>`
}

function humanMarkdown(source: string): string {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^<!-- branch:(?:start depth=\d+|end) -->\n?/gm, '')
}

export function renderShareHtml(document: ShareDocument, markdownUrl: string): string {
  const source = renderShareMarkdown(document)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(shareTitle(document))}</title><link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}"><style>html{font:16px/1.7 system-ui,sans-serif;color:#1f2328;background:#fff}body{max-width:960px;margin:0 auto;padding:48px 24px;overflow-wrap:anywhere}pre,table{max-width:100%;overflow:auto}img{max-width:100%}h1{font-size:2rem;border-bottom:1px solid #d0d7de;padding-bottom:.4em}h2,h3,h4,h5,h6{margin-top:1.8em}.share-visual{margin:24px 0;overflow:hidden;border:1px solid #d8dee4;border-radius:14px;background:#fff;box-shadow:0 4px 18px rgba(31,35,40,.06)}.share-visual-viewport{min-height:260px;padding:18px;overflow:auto;background-color:#f8fafc;background-image:linear-gradient(rgba(148,163,184,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.12) 1px,transparent 1px);background-size:24px 24px}.share-visual svg{display:block;width:min(100%,980px);height:auto;margin:auto}.share-visual text{fill:#1f2328;font:14px system-ui,sans-serif}.share-visual-group{fill:rgba(52,108,255,.035);stroke:#9bb6ff;stroke-dasharray:5 4}.share-visual-node{fill:#fff;stroke:#94a3b8}.share-visual-edge{fill:none;stroke:#94a3b8;stroke-width:1.5}.share-visual-edge-label{paint-order:stroke;stroke:#f8fafc;stroke-width:5px;stroke-linejoin:round}.share-visual figcaption{display:grid;gap:2px;padding:12px 16px;color:#57606a}.share-visual figcaption strong{color:#1f2328}.share-visual-data{border-top:1px solid #d8dee4;padding:10px 16px}.share-visual-data summary{cursor:pointer;color:#57606a}.share-visual-data pre{margin:10px 0 4px;padding:12px;border-radius:8px;background:#f6f8fa;font-size:12px}</style></head><body>${markdown.render(humanMarkdown(source))}</body></html>`
}
