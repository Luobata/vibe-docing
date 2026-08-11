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

function nodeText(node: ProseMirrorNode): string {
  if (node.type === 'hard_break') return '\n'
  return (node.text ?? '') + (node.content ?? []).map(nodeText).join('')
}

/**
 * Canonical document projection used by annotations. A visual atom contributes
 * exactly its validated reference alt text plus one newline. UI chrome and
 * renderer state never participate in this projection.
 */
export function prosemirrorToRenderRuns(json: string | null): ProseMirrorRenderRun[] {
  const document = parseDocument(json)
  if (!document) return []
  const runs: ProseMirrorRenderRun[] = []
  let offset = 0
  let pendingText = ''
  let pendingStart = 0
  const flushText = (): void => {
    if (!pendingText) return
    runs.push({ type: 'text', text: pendingText, start: pendingStart, end: pendingStart + pendingText.length })
    pendingText = ''
  }

  for (const [index, child] of (document.content ?? []).entries()) {
    if (child.type === 'visual_ref') {
      flushText()
      const checked = importVisualReference(child.attrs)
      if (!checked) continue
      const length = checked.altText.length + 1
      runs.push({ type: 'visual', reference: checked, start: offset, end: offset + length })
      offset += length
      pendingStart = offset
      continue
    }
    const text = nodeText(child)
    const separator = index < (document.content?.length ?? 0) - 1 ? '\n' : ''
    if (!pendingText) pendingStart = offset
    pendingText += text + separator
    offset += text.length + separator.length
  }
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
