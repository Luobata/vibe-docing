import { render, screen } from '@testing-library/react'
import type { ContextSegmentRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { MergedConclusions } from './MergedConclusions'

describe('MergedConclusions', () => {
  const seg = (over: Partial<ContextSegmentRow>): ContextSegmentRow => ({
    id: 'x', node_id: 'p1', seq: 1, type: 'merged-conclusion',
    ref_node_id: null, ref_version_no: null, content: null, ...over,
  })
  it('renders merged-conclusion segments as markdown', () => {
    render(<MergedConclusions segments={[seg({ content: '**要点**：内存更快' })]} />)
    expect(screen.getByText('要点', { exact: false })).toBeInTheDocument()
    expect(document.querySelector('strong')?.textContent).toBe('要点')
  })
  it('renders nothing when there are no merged-conclusion segments', () => {
    const { container } = render(<MergedConclusions segments={[seg({ type: 'ancestor-full', content: 'x' })]} />)
    expect(container.querySelector('[data-testid="merged-conclusions"]')).toBeNull()
  })
})
