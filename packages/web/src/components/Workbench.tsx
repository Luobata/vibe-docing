import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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

type WorkbenchPanel = 'main' | 'subdoc' | 'tree'

function SubdocOverflow({ nodeIds }: { nodeIds: string[] }) {
  const activeSubdocId = useWorkbench((state) => state.activeSubdocId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const setActiveSubdoc = useWorkbench((state) => state.setActiveSubdoc)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const selectedIndex = Math.max(0, nodeIds.indexOf(activeSubdocId ?? ''))
    setActiveIndex(selectedIndex)
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${selectedIndex}"]`)?.focus()
    const trigger = buttonRef.current?.getBoundingClientRect()
    const list = listRef.current?.getBoundingClientRect()
    if (trigger && list) setPlacement(trigger.bottom + list.height + 8 > window.innerHeight ? 'top' : 'bottom')
  }, [activeSubdocId, nodeIds, open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (buttonRef.current?.contains(event.target as Node) || listRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function choose(index: number): void {
    const id = nodeIds[index]
    if (!id) return
    setActiveSubdoc(id)
    setOpen(false)
    buttonRef.current?.focus()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let next = activeIndex
    if (event.key === 'ArrowDown') next = (activeIndex + 1) % nodeIds.length
    else if (event.key === 'ArrowUp') next = (activeIndex - 1 + nodeIds.length) % nodeIds.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = nodeIds.length - 1
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
      return
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    } else if (event.key === 'Tab') {
      setOpen(false)
      return
    } else return
    event.preventDefault()
    setActiveIndex(next)
    listRef.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.focus()
  }

  return (
    <div className="subdoc-overflow">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="subdoc-overflow-trigger"
        onClick={() => setOpen((shown) => !shown)}
        ref={buttonRef}
        title={`还有 ${nodeIds.length} 个分支`}
        type="button"
      >
        更多 ({nodeIds.length})
      </button>
      {open && (
        <div
          aria-label="更多子文档"
          className="subdoc-overflow-list"
          data-placement={placement}
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
        >
          {nodeIds.map((id, index) => {
            const label = nodeLabel(id, nodesById)
            return (
              <button
                aria-selected={id === activeSubdocId}
                data-option-index={index}
                key={id}
                onClick={() => choose(index)}
                role="option"
                tabIndex={index === activeIndex ? 0 : -1}
                title={label}
                type="button"
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
  const subdocPanelTab = useWorkbench((state) => state.subdocPanelTab)
  const subdocTabs = useWorkbench((state) => state.subdocTabs)
  const [mobilePanel, setMobilePanel] = useState<WorkbenchPanel>('main')
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [toastPaused, setToastPaused] = useState(false)
  const { leftWidth, rightWidth, startDrag, resetSide } = useColumnResize()
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const drawerRestoreFocusRef = useRef<HTMLElement | null>(null)
  const subdocRef = useRef<HTMLElement>(null)

  function closeTreeDrawer(): void {
    setTreeDrawerOpen(false)
    setTimeout(() => drawerRestoreFocusRef.current?.focus(), 0)
  }

  function openTreeDrawer(): void {
    drawerRestoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTreeDrawerOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (treeDrawerOpen) {
        event.preventDefault()
        closeTreeDrawer()
        return
      }
      exitFocus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [exitFocus, treeDrawerOpen])

  useEffect(() => {
    if (treeDrawerOpen) drawerCloseRef.current?.focus()
  }, [treeDrawerOpen])

  useEffect(() => {
    if (!toast || toastPaused) return
    const timer = setTimeout(() => useWorkbench.getState().clearToast(), 8000)
    return () => clearTimeout(timer)
  }, [toast, toastPaused])

  useEffect(() => {
    const buttons = subdocRef.current?.querySelectorAll<HTMLButtonElement>('.subdoc-tabs [role="tab"]')
    buttons?.forEach((button) => button.setAttribute('title', button.textContent?.trim() || '未命名'))
  }, [nodesById, subdocPanelTab, subdocTabs])

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
    } catch (error) {
      useWorkbench.getState().setToast('笔记保存失败，请重试。')
      throw error
    }
  }

  return (
    <div
      className="workbench"
      data-focus={focusMode}
      data-mobile-panel={mobilePanel}
      data-testid="workbench"
      style={{ '--col-left': leftWidth + 'px', '--col-right': rightWidth + 'px' } as React.CSSProperties}
    >
      <div aria-label="工作区面板" className="mobile-panel-tabs" role="tablist">
        {([
          ['tree', '树'],
          ['main', '文档'],
          ['subdoc', '子文档'],
        ] as const).map(([panel, label]) => (
          <button
            aria-controls={`${panel}-workbench-panel`}
            aria-selected={mobilePanel === panel}
            key={panel}
            onClick={() => setMobilePanel(panel)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <button
        aria-expanded={treeDrawerOpen}
        className="tablet-tree-toggle"
        onClick={openTreeDrawer}
        type="button"
      >
        打开树导航
      </button>
      {treeDrawerOpen && <button aria-label="关闭树导航" className="tree-drawer-backdrop" onClick={closeTreeDrawer} type="button" />}
      <aside
        aria-hidden={focusMode || undefined}
        aria-label="树导航"
        className={`tree-panel${focusMode ? ' is-collapsed' : ''}${treeDrawerOpen ? ' is-drawer-open' : ''}`}
        data-testid="tree-panel"
        id="tree-workbench-panel"
      >
        <button aria-label="关闭树导航" className="tree-drawer-close" onClick={closeTreeDrawer} ref={drawerCloseRef} type="button">×</button>
        <h1>树形对话工作台</h1>
        <TreeLauncher />
        <TreePanel
          key={treeId ?? 'no-tree'}
          onNodeSelect={() => {
            setMobilePanel('main')
            if (treeDrawerOpen) closeTreeDrawer()
          }}
        />
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
          data-side="left"
          onDoubleClick={() => resetSide('left')}
          onMouseDown={(e) => startDrag('left', e.clientX)}
          role="separator"
        />
      )}

      <main aria-label="主文档" className="main-doc" data-testid="main-doc" id="main-workbench-panel">
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
          data-side="right"
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
        id="subdoc-workbench-panel"
        ref={subdocRef}
      >
        <header className="panel-header">
          <div>
            <span className="eyebrow">子文档</span>
          </div>
        </header>
        <div className="subdoc-panel-content">
          <SubdocPanelTabs annotations={notesForMain} canCreateNote={!!mainNodeId} onCreateNote={handleCreateNote} />
          {subdocPanelTab === 'derivations' && subdocTabs.length > 6 && <SubdocOverflow nodeIds={subdocTabs.slice(6)} />}
        </div>
      </section>
      {toast && (
        <div className="workbench-toast" onMouseEnter={() => setToastPaused(true)} onMouseLeave={() => setToastPaused(false)} role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => useWorkbench.getState().clearToast()} type="button">×</button>
        </div>
      )}
    </div>
  )
}
