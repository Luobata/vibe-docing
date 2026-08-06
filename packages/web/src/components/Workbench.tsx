import { useEffect, useState } from 'react'
import { useWorkbench } from '../state/workbench-store'
import { Breadcrumb } from './Breadcrumb'
import { MainDoc } from './MainDoc'
import { SubdocTabs } from './SubdocTabs'
import { TrashPanel } from './TrashPanel'
import { TreePanel } from './TreePanel'
import { TreeLauncher } from './TreeLauncher'
import { VersionPanel } from './VersionPanel'
import './Workbench.css'

function nodeLabel(id: string | null, nodesById: ReturnType<typeof useWorkbench.getState>['nodesById']): string {
  if (!id) return '未选择文档'
  const node = nodesById[id]
  if (!node) return '未选择文档'
  return node.user_input?.split('\n')[0]?.trim() || (node.parent_id ? '未命名' : '根')
}

export function Workbench() {
  const focusMode = useWorkbench((state) => state.focusMode)
  const exitFocus = useWorkbench((state) => state.exitFocus)
  const toggleFocus = useWorkbench((state) => state.toggleFocus)
  const nodesById = useWorkbench((state) => state.nodesById)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const toast = useWorkbench((state) => state.toast)
  const treeId = useWorkbench((state) => state.treeId)
  const [showTrash, setShowTrash] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitFocus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [exitFocus])

  return (
    <div className="workbench" data-focus={focusMode} data-testid="workbench">
      <aside
        aria-label="树导航"
        className="tree-panel"
        data-testid="tree-panel"
        hidden={focusMode}
      >
        <h1>树形对话工作台</h1>
        <TreeLauncher />
        <TreePanel />
        {treeId && (
          <div className="utility-panel">
            <button onClick={() => setShowTrash((shown) => !shown)} type="button">
              {showTrash ? '收起回收站' : '打开回收站'}
            </button>
            {showTrash && <TrashPanel treeId={treeId} />}
          </div>
        )}
      </aside>

      <main aria-label="主文档" className="main-doc" data-testid="main-doc">
        <Breadcrumb />
        <header className="panel-header">
          <div>
            <span className="eyebrow">主文档</span>
            <h2>{nodeLabel(mainNodeId, nodesById)}</h2>
          </div>
          <div className="header-actions">
            {mainNodeId && (
              <button className="quiet-button" onClick={() => setShowVersions((shown) => !shown)} type="button">
                {showVersions ? '收起版本' : '版本历史'}
              </button>
            )}
            <button
              aria-label={focusMode ? '退出沉浸聚焦' : '进入沉浸聚焦'}
              className="quiet-button"
              onClick={toggleFocus}
              type="button"
            >
              {focusMode ? '退出聚焦' : '沉浸聚焦'}
            </button>
          </div>
        </header>
        {showVersions && mainNodeId && <VersionPanel nodeId={mainNodeId} />}
        <MainDoc />
      </main>

      <section
        aria-label="子文档"
        className="subdoc-panel"
        data-testid="subdoc-panel"
      >
        <header className="panel-header">
          <div>
            <span className="eyebrow">子文档</span>
            <h2>派生分支</h2>
          </div>
        </header>
        <SubdocTabs />
      </section>
      {toast && <div role="status">{toast}</div>}
    </div>
  )
}
