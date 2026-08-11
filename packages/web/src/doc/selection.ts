export interface PlainSelection {
  from: number
  text: string
  to: number
}

function textOffset(container: HTMLElement, target: Node, targetOffset: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === target) return offset + targetOffset
    offset += current.textContent?.length ?? 0
  }

  if (target.nodeType === Node.ELEMENT_NODE && container.contains(target)) {
    const range = document.createRange()
    range.selectNodeContents(container)
    try {
      range.setEnd(target, targetOffset)
    } catch {
      return null
    }
    return range.cloneContents().textContent?.length ?? 0
  }
  return null
}

export function getPlainSelection(container: HTMLElement): PlainSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
  const startElement = (range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement)?.closest<HTMLElement>('[data-text-start]')
  const endElement = (range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer as Element
    : range.endContainer.parentElement)?.closest<HTMLElement>('[data-text-start]')
  if (!startElement || !endElement) {
    const from = textOffset(container, range.startContainer, range.startOffset)
    const to = textOffset(container, range.endContainer, range.endOffset)
    const text = range.toString()
    return from !== null && to !== null && to > from && text ? { from, text, to } : null
  }

  const startPrefix = range.cloneRange()
  startPrefix.selectNodeContents(startElement)
  startPrefix.setEnd(range.startContainer, range.startOffset)
  const startBase = Number(startElement.dataset.textStart ?? 0)
  const from = startBase + startPrefix.toString().length

  if (startElement === endElement) {
    const text = range.toString()
    return text ? { from, text, to: from + text.length } : null
  }

  const endPrefix = range.cloneRange()
  endPrefix.selectNodeContents(endElement)
  endPrefix.setEnd(range.endContainer, range.endOffset)
  const endBase = Number(endElement.dataset.textStart ?? 0)
  const to = endBase + endPrefix.toString().length
  const runs = Array.from(container.querySelectorAll<HTMLElement>('[data-text-start]'))
  const startIndex = runs.indexOf(startElement)
  const endIndex = runs.indexOf(endElement)
  if (startIndex < 0 || endIndex <= startIndex || to <= from) return null
  const startCanonical = startElement.dataset.canonicalText ?? startElement.textContent ?? ''
  const text = startCanonical.slice(from - startBase)
    + runs.slice(startIndex + 1, endIndex).map((element) => element.dataset.canonicalText ?? '').join('')
    + (endElement.dataset.canonicalText ?? endElement.textContent ?? '').slice(0, to - endBase)
  return text ? { from, text, to } : null
}
