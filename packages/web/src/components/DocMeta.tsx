import type { NodeRow } from '@vibe/shared'
import { formatRelativeTime } from './format-time'
import { TagChips } from './TagChips'

/** 主文档 meta 行（Round 13 · B/C）：创建/更新相对时间 + 标签 chips。 */
export function DocMeta({ node }: { node: NodeRow }) {
  const created = formatRelativeTime(node.created_at)
  const updated = formatRelativeTime(node.updated_at)
  return (
    <div className="doc-meta">
      {(created || updated) && (
        <span
          className="doc-meta-time"
          title={`创建于 ${node.created_at} · 更新于 ${node.updated_at}`}
        >
          {created && `创建于 ${created}`}
          {created && updated && ' · '}
          {updated && `更新于 ${updated}`}
        </span>
      )}
      <TagChips node={node} />
    </div>
  )
}
