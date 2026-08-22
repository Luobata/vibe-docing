import { normalizeFencedCodeBlocks } from '@vibe/shared'
import MarkdownIt from 'markdown-it'
import type { AnnotationRange } from './highlight'

// html:false → raw inline/block HTML in the source is escaped, not passed
// through (blocks the obvious XSS vector). linkify off to avoid surprise links.
const md = new MarkdownIt({ breaks: true, html: false, linkify: false })

// Obsidian-style internal links are not CommonMark, but keeping their source
// syntax and reading-view label makes an imported Vault feel native. Navigation
// is intentionally deferred until the document-association model is settled.
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const start = state.pos
  if (state.src.slice(start, start + 2) !== '[[') return false
  const end = state.src.indexOf(']]', start + 2)
  if (end < 0) return false
  const raw = state.src.slice(start + 2, end)
  const [destination, ...aliasParts] = raw.split('|')
  if (!destination.trim()) return false
  if (!silent) {
    const token = state.push('wikilink', '', 0)
    token.meta = {
      destination: destination.trim(),
      label: aliasParts.length > 0 ? aliasParts.join('|').trim() : destination.trim(),
    }
  }
  state.pos = end + 2
  return true
})

md.renderer.rules.wikilink = (tokens, index) => {
  const meta = tokens[index]?.meta as { destination?: string; label?: string } | undefined
  const destination = md.utils.escapeHtml(meta?.destination ?? '')
  const label = md.utils.escapeHtml(meta?.label ?? meta?.destination ?? '')
  return `<span class="internal-link is-unresolved" data-wikilink="${destination}">${label}</span>`
}

// Task items are an everyday Obsidian convention. Convert only a leading
// [ ]/[x] inside a real list item into a disabled checkbox; the Markdown source
// remains byte-for-byte unchanged.
md.core.ruler.after('inline', 'task-list-items', (state) => {
  for (let index = 0; index < state.tokens.length; index += 1) {
    const inline = state.tokens[index]
    if (inline.type !== 'inline' || !inline.children?.length) continue
    const first = inline.children[0]
    if (first.type !== 'text') continue
    const match = /^\[([ xX])\]\s+/.exec(first.content)
    if (!match) continue

    let itemIndex = index - 1
    while (itemIndex >= 0 && state.tokens[itemIndex].type !== 'list_item_open') itemIndex -= 1
    if (itemIndex < 0) continue
    let listIndex = itemIndex - 1
    while (listIndex >= 0 && !['bullet_list_open', 'ordered_list_open'].includes(state.tokens[listIndex].type)) listIndex -= 1
    if (listIndex < 0) continue

    const checked = match[1].toLowerCase() === 'x'
    state.tokens[itemIndex].attrJoin('class', 'task-list-item')
    if (!state.tokens[listIndex].attrGet('class')?.split(/\s+/).includes('contains-task-list')) {
      state.tokens[listIndex].attrJoin('class', 'contains-task-list')
    }
    first.content = first.content.slice(match[0].length)
    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input aria-label="${checked ? '已完成' : '未完成'}"${checked ? ' checked' : ''} disabled type="checkbox"> `
    inline.children.unshift(checkbox)
  }
})

md.renderer.rules.table_open = () => '<div class="doc-table-scroll"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'

// A GitHub-flavored table row: starts and ends with a pipe, tolerating leading
// blockquote markers (`> | … |`). The delimiter row `| --- | --- |` matches too.
const TABLE_ROW = /^\s*>?\s*\|.*\|\s*$/
// The delimiter row directly under a table header: only pipes, dashes, colons
// and spaces, and it must contain at least one dash. Optional `>` (blockquote)
// and outer pipes are tolerated.
const TABLE_DELIMITER = /^\s*>?\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
// A blank separator line: truly empty, or an empty blockquote line (`>`).
const BLANK_LINE = /^\s*>?\s*$/

/**
 * Models frequently emit GitHub tables that markdown-it won't parse, because a
 * table only forms when a header row is a *fresh block*:
 *
 *  1. A paragraph (or a blockquote whose lazy continuation swallows the next
 *     lines) sits directly above the header with no blank line between — the
 *     header is absorbed into that paragraph and the pipes leak as text.
 *  2. Rows are separated by blank lines, splitting the table into paragraphs.
 *
 * Normalize both: ensure exactly one blank line before a header row (a pipe row
 * immediately followed by a delimiter row), and drop blank lines that sit
 * strictly between two table rows. Blank lines elsewhere are left untouched.
 */
function normalizeTables(text: string): string {
  const lines = text.split('\n')

  // Pass 1: remove blank lines wedged between two table rows.
  const joined: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (BLANK_LINE.test(lines[i])) {
      let j = i
      while (j < lines.length && BLANK_LINE.test(lines[j])) j++
      const prev = joined[joined.length - 1]
      const next = lines[j]
      if (prev !== undefined && TABLE_ROW.test(prev) && next !== undefined && TABLE_ROW.test(next)) {
        i = j - 1 // skip the blank run; the loop's i++ lands on the next row
        continue
      }
    }
    joined.push(lines[i])
  }

  // Pass 2: guarantee a blank line before every table header so it starts a
  // fresh block instead of being absorbed by the paragraph/blockquote above.
  const out: string[] = []
  for (let i = 0; i < joined.length; i++) {
    const isHeader =
      TABLE_ROW.test(joined[i]) &&
      i + 1 < joined.length &&
      TABLE_DELIMITER.test(joined[i + 1])
    if (isHeader) {
      const prev = out[out.length - 1]
      if (prev !== undefined && !BLANK_LINE.test(prev) && !TABLE_ROW.test(prev)) {
        out.push('')
      }
    }
    out.push(joined[i])
  }
  return out.join('\n')
}

export function renderMarkdown(text: string): string {
  // 渲染前规整：病态围栏空行（AI 生成物常见） + Obsidian 表格。仅改动命中病态
  // 模式的围栏，正常代码块逐字保留。
  return md.render(normalizeTables(normalizeFencedCodeBlocks(text ?? '')))
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
