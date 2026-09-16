import { documentContentOf, legacyDocumentToMarkdown, normalizeMarkdown, prosemirrorToPlainText, type NodeRow } from '@vibe/shared'

export function downloadNodeMarkdown(node: NodeRow, treeTitle: string): void {
  const title = prosemirrorToPlainText(node.user_input).trim().split('\n')[0] || treeTitle
  downloadMarkdown(normalizeMarkdown(legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0)), title)
}

export function markdownFilename(title: string): string {
  return `${title.replace(/[\\/"\r\n]/g, '_').slice(0, 100) || 'document'}.md`
}

export function downloadMarkdown(content: string, title: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = markdownFilename(title)
  document.body.append(link)
  try { link.click() }
  finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
