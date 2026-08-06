export interface PlainSelection {
  from: number
  text: string
  to: number
}

export function getPlainSelection(container: HTMLElement): PlainSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const prefix = range.cloneRange()
  prefix.selectNodeContents(container)
  prefix.setEnd(range.startContainer, range.startOffset)
  const text = range.toString()
  const from = prefix.toString().length
  return text ? { from, text, to: from + text.length } : null
}
