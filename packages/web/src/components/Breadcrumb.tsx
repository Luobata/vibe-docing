import { useWorkbench } from '../state/workbench-store'
import { nodeTitle } from './TreePanel'

export function Breadcrumb() {
  const backStack = useWorkbench((state) => state.backStack)
  const forwardStack = useWorkbench((state) => state.forwardStack)
  const goBack = useWorkbench((state) => state.goBack)
  const goForward = useWorkbench((state) => state.goForward)
  const mainPath = useWorkbench((state) => state.mainPath)
  const nodesById = useWorkbench((state) => state.nodesById)
  const setMain = useWorkbench((state) => state.setMain)

  return (
    <div className="navigation-strip">
      <div aria-label="历史导航" className="history-controls">
        <button aria-label="后退" disabled={backStack.length === 0} onClick={goBack} type="button">
          ←
        </button>
        <button
          aria-label="前进"
          disabled={forwardStack.length === 0}
          onClick={goForward}
          type="button"
        >
          →
        </button>
      </div>
      <nav aria-label="面包屑" className="breadcrumb">
        {mainPath.map((id) => (
          <span className="breadcrumb-item" key={id}>
            <button
              aria-current={id === mainPath[mainPath.length - 1] ? 'page' : undefined}
              onClick={() => setMain(id)}
              type="button"
            >
              {nodeTitle(nodesById[id])}
            </button>
          </span>
        ))}
      </nav>
    </div>
  )
}

