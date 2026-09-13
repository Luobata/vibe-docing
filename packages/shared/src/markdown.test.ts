import { describe, expect, it } from 'vitest'
import { legacyDocumentToMarkdown } from './markdown'

describe('legacyDocumentToMarkdown', () => {
  it.each([0, 1, 2, 99])('recognizes an empty or populated document despite schema %i', (schema) => {
    expect(legacyDocumentToMarkdown('{"content":[{"content":[],"type":"paragraph"}],"type":"doc"}', schema)).toBe('')
    expect(legacyDocumentToMarkdown('{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Title"}]}]}', schema)).toBe('## Title')
  })

  it('does not expose a recognized document when its contents cannot be converted', () => {
    expect(legacyDocumentToMarkdown('{"type":"doc","content":false}', 2)).toBe('')
  })

  it('preserves native JSON notes that are not editor documents', () => {
    const source = '{ "custom": true, "items": [] }'
    expect(legacyDocumentToMarkdown(source, 2)).toBe(source)
  })

  it('preserves native Markdown byte-for-byte', () => {
    const source = '---\ncustom: "[[A]]" # keep\n---\n\n> [!note]\n> Keep me\n\n```dataview\nLIST\n```\n'
    expect(legacyDocumentToMarkdown(source, 2)).toBe(source)
    expect(legacyDocumentToMarkdown(source, 0)).toBe(source)
  })

  it('converts legacy semantic blocks to portable Markdown', () => {
    const source = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] },
        { type: 'visual_ref', attrs: { artifactId: 'flow-1', revision: 2, altText: 'Flow' } },
      ],
    })
    expect(legacyDocumentToMarkdown(source, 1)).toBe('## Title\n\n**Bold**\n\n![[vibe-visual:flow-1@2|Flow]]')
  })
})
