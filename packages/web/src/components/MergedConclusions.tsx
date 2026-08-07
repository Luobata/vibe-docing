import type { ContextSegmentRow } from '@vibe/shared'
import { renderMarkdown } from '../doc/markdown'

export function MergedConclusions({ segments }: { segments: ContextSegmentRow[] }) {
  const merged = segments.filter((s) => s.type === 'merged-conclusion' && s.content)
  if (merged.length === 0) return null
  return (
    <section className="merged-conclusions" data-testid="merged-conclusions">
      <h3>合并结论</h3>
      {merged.map((s) => (
        <div className="merged-conclusion-item" key={s.id}>
          <div className="doc-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.content ?? '') }} />
        </div>
      ))}
    </section>
  )
}
