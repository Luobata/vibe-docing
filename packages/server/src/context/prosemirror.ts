interface ProseMirrorNode {
  content?: ProseMirrorNode[]
  text?: string
  type?: string
}

export function prosemirrorToPlainText(json: string | null): string {
  if (!json) return ''

  let document: ProseMirrorNode
  try {
    document = JSON.parse(json) as ProseMirrorNode
  } catch {
    return ''
  }

  function textOf(node: ProseMirrorNode): string {
    if (node.type === 'hard_break') return '\n'
    return (node.text ?? '') + (node.content ?? []).map(textOf).join('')
  }

  return (document.content ?? []).map(textOf).join('\n')
}

export function plainTextToProseMirror(text: string): string {
  return JSON.stringify({
    content: text.split('\n').map((line) => ({
      content: line ? [{ text: line, type: 'text' }] : [],
      type: 'paragraph',
    })),
    type: 'doc',
  })
}
