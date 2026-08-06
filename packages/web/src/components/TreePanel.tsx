import type { NodeRow } from '@vibe/shared'
import { useWorkbench } from '../state/workbench-store'

export function nodeTitle(node: NodeRow | undefined): string {
  if (!node) return '未命名'
  if (!node.parent_id) return node.user_input?.split('\n')[0]?.trim() || '根'
  return node.user_input?.split('\n')[0]?.trim() || '未命名'
}

function TreeBranch({ nodeId }: { nodeId: string }) {
  const nodesById = useWorkbench((state) => state.nodesById)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const setMain = useWorkbench((state) => state.setMain)
  const node = nodesById[nodeId]
  if (!node || node.is_deleted === 1) return null
  const children = Object.values(nodesById)
    .filter((candidate) => candidate.parent_id === node.id && candidate.is_deleted === 0)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )

  return (
    <li>
      <button
        aria-current={mainNodeId === node.id ? 'page' : undefined}
        onClick={() => setMain(node.id)}
        type="button"
      >
        <span aria-hidden="true">{children.length ? '⌄' : '·'}</span>{' '}
        {nodeTitle(node)}
      </button>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeBranch key={child.id} nodeId={child.id} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TreePanel() {
  const rootNodeId = useWorkbench((state) => state.rootNodeId)
  if (!rootNodeId) return <p className="empty-state">暂无内容</p>
  return (
    <nav aria-label="文档树">
      <ul className="tree-root">
        <TreeBranch nodeId={rootNodeId} />
      </ul>
    </nav>
  )
}

