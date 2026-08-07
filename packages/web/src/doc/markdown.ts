import MarkdownIt from 'markdown-it'
import type { AnnotationRange } from './highlight'

// html:false → raw inline/block HTML in the source is escaped, not passed
// through (blocks the obvious XSS vector). linkify off to avoid surprise links.
const md = new MarkdownIt({ breaks: true, html: false, linkify: false })

export function renderMarkdown(text: string): string {
  return md.render(text ?? '')
}

/**
 * Render markdown to HTML, then wrap the given annotation ranges — expressed as
 * offsets into the *visible* text — in <mark data-ann-id> elements. Markdown
 * structure (headings, bold, lists, tables) is preserved; marks are layered on
 * top by splitting the DOM text nodes that fall inside each range.
 */
export function renderAnnotatedHtml(
  text: string,
  annotations: AnnotationRange[],
): string {
  const html = renderMarkdown(text)
  const ranges = annotations.filter((a) => a.from < a.to)
  if (ranges.length === 0) return html

  const container = document.createElement('div')
  container.innerHTML = html

  // Walk text nodes in document order, tracking the running visible-text offset.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text)
  }

  let offset = 0
  for (const textNode of textNodes) {
    const nodeText = textNode.data
    const nodeStart = offset
    const nodeEnd = offset + nodeText.length
    offset = nodeEnd

    // Which ranges overlap this text node? Build the marked pieces in order.
    const pieces: Array<{ annId: string | null; text: string }> = []
    let cursor = nodeStart
    while (cursor < nodeEnd) {
      const owner = ranges.find((r) => r.from <= cursor && r.to > cursor)
      const nextBoundary = ranges
        .flatMap((r) => [r.from, r.to])
        .filter((b) => b > cursor && b <= nodeEnd)
        .sort((a, b) => a - b)[0] ?? nodeEnd
      const sliceEnd = owner ? Math.min(owner.to, nextBoundary) : nextBoundary
      pieces.push({
        annId: owner?.id ?? null,
        text: nodeText.slice(cursor - nodeStart, sliceEnd - nodeStart),
      })
      cursor = sliceEnd
    }

    if (pieces.length === 1 && pieces[0].annId === null) continue

    const fragment = document.createDocumentFragment()
    for (const piece of pieces) {
      if (piece.annId) {
        const mark = document.createElement('mark')
        mark.setAttribute('data-ann-id', piece.annId)
        mark.textContent = piece.text
        fragment.appendChild(mark)
      } else {
        fragment.appendChild(document.createTextNode(piece.text))
      }
    }
    textNode.parentNode?.replaceChild(fragment, textNode)
  }

  return container.innerHTML
}
