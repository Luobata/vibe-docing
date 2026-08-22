import { describe, expect, it } from 'vitest'
import { legacyDocumentToMarkdown } from './markdown'

describe('legacyDocumentToMarkdown', () => {
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
