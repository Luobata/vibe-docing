import { describe, expect, it } from 'vitest'
import { prosemirrorToPlainText, prosemirrorToRenderRuns } from './prosemirror'

describe('document text projection', () => {
  it('projects empty documents without exposing their serialized JSON', () => {
    const source = '{"content":[{"content":[],"type":"paragraph"}],"type":"doc"}'
    expect(prosemirrorToRenderRuns(source)).toEqual([])
    expect(prosemirrorToPlainText(source)).toBe('')
  })

  it('keeps native text and JSON notes that are not editor documents', () => {
    for (const source of ['# Native\n\nbody', '{ "custom": true }', 'null']) {
      expect(prosemirrorToPlainText(source)).toBe(source)
    }
  })

  it('does not expose recognized documents whose contents cannot be projected', () => {
    expect(prosemirrorToRenderRuns('{"type":"doc","content":false}')).toEqual([])
  })
})
