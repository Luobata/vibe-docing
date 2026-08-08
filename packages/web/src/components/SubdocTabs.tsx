import { useWorkbench } from '../state/workbench-store'
import { DocView } from './DocView'
import { MergeButton } from './MergeButton'
import { nodeTitle } from './TreePanel'

export function SubdocTabs() {
  const activeSubdocId = useWorkbench((state) => state.activeSubdocId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const promoteSubdoc = useWorkbench((state) => state.promoteSubdoc)
  const setActiveSubdoc = useWorkbench((state) => state.setActiveSubdoc)
  const subdocTabs = useWorkbench((state) => state.subdocTabs)

  if (subdocTabs.length === 0) return <p className="empty-state">还没有派生分支</p>
  const currentId = activeSubdocId ?? subdocTabs[0]
  const current = nodesById[currentId]

  return (
    <div className="subdoc-tabs-shell">
      <div aria-label="子文档标签" className="subdoc-tabs" role="tablist">
        {subdocTabs.map((id) => (
          <button
            aria-selected={id === currentId}
            key={id}
            onClick={() => setActiveSubdoc(id)}
            role="tab"
            type="button"
          >
            {nodeTitle(nodesById[id])}
          </button>
        ))}
      </div>
      {current && (
        <article className="subdoc-card" role="tabpanel">
          <header>
            <h3>{nodeTitle(current)}</h3>
            <button
              aria-label="promote"
              className="primary-button"
              onClick={() => promoteSubdoc(current.id)}
              type="button"
            >
              聚焦此文档
            </button>
          </header>
          <DocView annotations={[]} node={current} onRetry={() => {}} onSelect={() => {}} />
          {current.parent_id && (
            <MergeButton
              onMerged={() => useWorkbench.getState().bumpMergeRefresh()}
              sourceNodeId={current.id}
              targetNodeId={current.parent_id}
            />
          )}
        </article>
      )}
    </div>
  )
}
