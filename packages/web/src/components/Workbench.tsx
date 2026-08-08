import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { useColumnResize } from '../flow/use-column-resize'
import { useWorkbench } from '../state/workbench-store'
import { Breadcrumb } from './Breadcrumb'
import { MainDoc } from './MainDoc'
import { SettingsPanel } from './SettingsPanel'
import { SubdocPanelTabs } from './SubdocPanelTabs'
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
  const api = useApi()
  const focusMode = useWorkbench((state) => state.focusMode)
  const exitFocus = useWorkbench((state) => state.exitFocus)
  const toggleFocus = useWorkbench((state) => state.toggleFocus)
  const nodesById = useWorkbench((state) => state.nodesById)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const notesForMain = useWorkbench((state) => state.notesForMain)
  const toast = useWorkbench((state) => state.toast)
  const treeId = useWorkbench((state) => state.treeId)
  const [showTrash, setShowTrash] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { leftWidth, rightWidth, startDrag, resetSide } = useColumnResize()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitFocus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [exitFocus])

  async function handleCreateNote(note: string): Promise<void> {
    if (!mainNodeId) return
    const targetNodeId = mainNodeId
    try {
      const res = await api.createNote(targetNodeId, {
        anchorFrom: null, anchorTo: null, quotedText: null, note,
      })
      // The main node may have switched while createNote was in flight; only
      // append to the current node's list, and dedupe by id so a merge-refetch
      // that already inserted this row does not produce a duplicate React key.
      const cur = useWorkbench.getState().notesForMain
      if (useWorkbench.getState().mainNodeId === targetNodeId && !cur.some((a) => a.id === res.annotation.id)) {
        useWorkbench.getState().setNotesForMain([...cur, res.annotation])
      }
    } catch {
      useWorkbench.getState().setToast('笔记保存失败，请重试。')
    }
  }

  return (
    <div
      className="workbench"
      data-focus={focusMode}
      data-testid="workbench"
      style={{ '--col-left': leftWidth + 'px', '--col-right': rightWidth + 'px' } as React.CSSProperties}
    >
      <aside
        aria-hidden={focusMode || undefined}
        aria-label="树导航"
        className={`tree-panel${focusMode ? ' is-collapsed' : ''}`}
        data-testid="tree-panel"
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

      {!focusMode && (
        <div
          aria-orientation="vertical"
          className="col-resizer"
          onDoubleClick={() => resetSide('left')}
          onMouseDown={(e) => startDrag('left', e.clientX)}
          role="separator"
        />
      )}

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
            <button className="quiet-button" onClick={() => setShowSettings((shown) => !shown)} type="button">
              {showSettings ? '收起设置' : '设置'}
            </button>
          </div>
        </header>
        {showSettings && <SettingsPanel />}
        {showVersions && mainNodeId && <VersionPanel nodeId={mainNodeId} />}
        <MainDoc />
      </main>

      {!focusMode && (
        <div
          aria-orientation="vertical"
          className="col-resizer"
          onDoubleClick={() => resetSide('right')}
          onMouseDown={(e) => startDrag('right', e.clientX)}
          role="separator"
        />
      )}

      <section
        aria-hidden={focusMode || undefined}
        aria-label="子文档"
        className={`subdoc-panel${focusMode ? ' is-collapsed' : ''}`}
        data-testid="subdoc-panel"
      >
        <header className="panel-header">
          <div>
            <span className="eyebrow">子文档</span>
          </div>
        </header>
        <SubdocPanelTabs annotations={notesForMain} canCreateNote={!!mainNodeId} onCreateNote={(note) => { void handleCreateNote(note) }} />
      </section>
      {toast && <div role="status">{toast}</div>}
    </div>
  )
}
