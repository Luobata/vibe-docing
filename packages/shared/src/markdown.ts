import type { ProseMirrorNode } from './prosemirror'

function attrs(node: ProseMirrorNode): Record<string, unknown> {
  return node.attrs ?? {}
}

function inline(node: ProseMirrorNode): string {
  if (node.type !== 'text') return block(node)
  let value = node.text ?? ''
  const marks = Array.isArray((node as ProseMirrorNode & { marks?: Array<{ attrs?: Record<string, unknown>; type?: string }> }).marks)
    ? (node as ProseMirrorNode & { marks: Array<{ attrs?: Record<string, unknown>; type?: string }> }).marks
    : []
  for (const mark of marks) {
    if (mark.type === 'bold') value = `**${value}**`
    else if (mark.type === 'italic') value = `*${value}*`
    else if (mark.type === 'strike') value = `~~${value}~~`
    else if (mark.type === 'code') value = `\`${value}\``
    else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') value = `[${value}](${mark.attrs.href})`
  }
  return value
}

function children(node: ProseMirrorNode, separator = ''): string {
  return (node.content ?? []).map(inline).join(separator)
}

function list(node: ProseMirrorNode, ordered: boolean): string {
  return (node.content ?? []).map((item, index) => {
    const body = children(item).trimEnd().replace(/\n/g, '\n  ')
    return `${ordered ? `${index + 1}.` : '-'} ${body}`
  }).join('\n')
}

function table(node: ProseMirrorNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => children(cell).trim().replace(/\|/g, '\\|')))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')])
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function block(node: ProseMirrorNode): string {
  const type = node.type ?? ''
  if (type === 'text') return inline(node)
  if (type === 'hard_break' || type === 'hardBreak') return '  \n'
  if (type === 'paragraph') return children(node)
  if (type === 'heading') return `${'#'.repeat(Number(attrs(node).level) || 1)} ${children(node)}`
  if (type === 'horizontal_rule' || type === 'horizontalRule') return '---'
  if (type === 'blockquote') return children(node, '\n\n').split('\n').map((line) => `> ${line}`).join('\n')
  if (type === 'bullet_list' || type === 'bulletList') return list(node, false)
  if (type === 'ordered_list' || type === 'orderedList') return list(node, true)
  if (type === 'list_item' || type === 'listItem') return children(node, '\n')
  if (type === 'task_list' || type === 'taskList') return children(node, '\n')
  if (type === 'task_item' || type === 'taskItem') return `- [${attrs(node).checked ? 'x' : ' '}] ${children(node).trimEnd()}`
  if (type === 'code_block' || type === 'codeBlock') {
    const language = typeof attrs(node).language === 'string' ? attrs(node).language : ''
    return `\`\`\`${language}\n${children(node)}\n\`\`\``
  }
  if (type === 'table') return table(node)
  if (type === 'table_row' || type === 'tableRow' || type === 'table_cell' || type === 'tableCell'
    || type === 'table_header' || type === 'tableHeader') return children(node)
  if (type === 'visual_ref') {
    const reference = attrs(node)
    const artifactId = typeof reference.artifactId === 'string' ? reference.artifactId : 'unknown'
    const revision = Number.isInteger(reference.revision) ? Number(reference.revision) : 1
    const altText = typeof reference.altText === 'string' ? reference.altText : '可视化'
    return `![[vibe-visual:${artifactId}@${revision}|${altText}]]`
  }
  return children(node)
}

/** Recognize editor documents by shape; native Markdown remains byte-for-byte unchanged. */
export function legacyDocumentToMarkdown(source: string | null, _schemaVersion = 0): string {
  if (!source) return ''
  let document: ProseMirrorNode
  try {
    document = JSON.parse(source) as ProseMirrorNode
  } catch {
    return source
  }
  if (!document || document.type !== 'doc') return source
  try {
    return (document.content ?? []).map(block).join('\n\n').replace(/\n{3,}/g, '\n\n')
  } catch {
    return ''
  }
}
