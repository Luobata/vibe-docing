export interface ProseMirrorNode {
  attrs?: Record<string, unknown>
  content?: ProseMirrorNode[]
  text?: string
  type?: string
}

export type ProseMirrorRenderRun =
  | { type: 'text'; text: string; start: number; end: number }
  | { type: 'visual'; reference: import('./visual-artifact').VisualReference; start: number; end: number }

function parseDocument(json: string | null): ProseMirrorNode | undefined {
  if (!json) return undefined
  try {
    return JSON.parse(json) as ProseMirrorNode
  } catch {
    return undefined
  }
}

/**
 * Canonical document projection used by annotations. A visual atom contributes
 * exactly its validated reference alt text plus one newline. UI chrome and
 * renderer state never participate in this projection.
 */
export function prosemirrorToRenderRuns(json: string | null): ProseMirrorRenderRun[] {
  const document = parseDocument(json)
  if (!document) return json ? [{ type: 'text', text: json, start: 0, end: json.length }] : []
  const runs: ProseMirrorRenderRun[] = []
  let offset = 0
  let pendingText = ''
  let pendingStart = 0
  let endsWithNewline = false
  const flushText = (): void => {
    if (!pendingText) return
    runs.push({ type: 'text', text: pendingText, start: pendingStart, end: pendingStart + pendingText.length })
    pendingText = ''
  }

  const appendText = (value: string): void => {
    if (!value) return
    if (!pendingText) pendingStart = offset
    pendingText += value
    offset += value.length
    endsWithNewline = value.endsWith('\n')
  }

  const separatorFor = (node: ProseMirrorNode): string => {
    if (node.type === 'table_row' || node.type === 'tableRow') return '\t'
    if (['doc', 'blockquote', 'bullet_list', 'ordered_list', 'list_item',
      'task_list', 'task_item', 'table', 'table_cell', 'table_header',
      'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
      'tableCell', 'tableHeader'].includes(node.type ?? '')) return '\n'
    return ''
  }

  const visit = (node: ProseMirrorNode): void => {
    if (node.type === 'visual_ref') {
      flushText()
      const checked = importVisualReference(node.attrs)
      if (!checked) return
      const length = checked.altText.length + 1
      runs.push({ type: 'visual', reference: checked, start: offset, end: offset + length })
      offset += length
      pendingStart = offset
      endsWithNewline = true
      return
    }

    if (node.type === 'hard_break' || node.type === 'hardBreak') {
      appendText('\n')
      return
    }
    appendText(node.text ?? '')
    const children = node.content ?? []
    const separator = separatorFor(node)
    children.forEach((child, index) => {
      visit(child)
      if (index < children.length - 1 && separator) {
        if (separator !== '\n' || !endsWithNewline) appendText(separator)
      }
    })
  }

  visit(document)
  flushText()
  return runs
}

function importVisualReference(value: unknown): import('./visual-artifact').VisualReference | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reference = value as Record<string, unknown>
  if (typeof reference.artifactId !== 'string' || !reference.artifactId.trim()
    || !Number.isInteger(reference.revision) || (reference.revision as number) < 1
    || typeof reference.altText !== 'string' || !reference.altText.trim()) return undefined
  return reference as unknown as import('./visual-artifact').VisualReference
}

export function prosemirrorToPlainText(json: string | null): string {
  return prosemirrorToRenderRuns(json).map((run) =>
    run.type === 'visual' ? `${run.reference.altText}\n` : run.text).join('')
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
