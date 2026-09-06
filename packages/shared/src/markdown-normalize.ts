import { normalizeFencedCodeBlocks } from './code-fence'

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
 * Normalize loose GitHub tables without changing unrelated Markdown.
 *
 * Models sometimes omit the blank line before a table or insert blank lines
 * between every row. Both forms prevent markdown-it from recognizing the
 * table, so make the header a fresh block and join only row-to-row gaps.
 */
export function normalizeTables(markdown: string): string {
  const lines = markdown.split('\n')

  const joined: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (BLANK_LINE.test(lines[i])) {
      let j = i
      while (j < lines.length && BLANK_LINE.test(lines[j])) j += 1
      const previous = joined[joined.length - 1]
      const next = lines[j]
      if (previous !== undefined && TABLE_ROW.test(previous) && next !== undefined && TABLE_ROW.test(next)) {
        i = j - 1
        continue
      }
    }
    joined.push(lines[i])
  }

  const out: string[] = []
  for (let i = 0; i < joined.length; i += 1) {
    const isHeader = TABLE_ROW.test(joined[i])
      && i + 1 < joined.length
      && TABLE_DELIMITER.test(joined[i + 1])
    if (isHeader) {
      const previous = out[out.length - 1]
      if (previous !== undefined && !BLANK_LINE.test(previous) && !TABLE_ROW.test(previous)) {
        out.push('')
      }
    }
    out.push(joined[i])
  }
  return out.join('\n')
}

/** Apply the shared, renderer-neutral Markdown cleanup pipeline once. */
export function normalizeMarkdown(markdown: string): string {
  return normalizeTables(normalizeFencedCodeBlocks(markdown))
}
