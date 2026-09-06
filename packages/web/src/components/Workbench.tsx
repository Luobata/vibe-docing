import type { AnnotationRow } from '@vibe/shared'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useApi } from '../api/context'
import { COLUMN_MIN_WIDTHS, getColumnMaxWidth, useColumnResize, type ColumnSide } from '../flow/use-column-resize'
import { scrollMainDocumentToTop } from '../flow/document-transition'
import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { useWorkbenchRoute } from '../flow/workbench-route'
import { Breadcrumb } from './Breadcrumb'
import { DocMeta } from './DocMeta'
import { Icon } from './Icon'
import { MainDoc } from './MainDoc'
import { MainQuestionSummary } from './MainQuestionSummary'
import { SessionMap } from './SessionMap'
import { SettingsPanel } from './SettingsPanel'
import { SharePanel } from './SharePanel'
import { SubdocPanelTabs } from './SubdocPanelTabs'
import { GenerationBadge, generationBadgeState } from './SubdocTabs'
import { groupSubdocIds, isSelectionSource } from './subdoc-classification'
import { TrashPage } from './TrashPage'
import { nodeTitle, TreePanel } from './TreePanel'
import { TreeLauncher } from './TreeLauncher'
import { SearchPalette } from './SearchPalette'
import { VersionPanel } from './VersionPanel'
import './Workbench.css'

type WorkbenchPanel = 'main' | 'subdoc' | 'tree'
const MOBILE_PANELS: ReadonlyArray<readonly [WorkbenchPanel, string]> = [
  ['tree', '笔记库'],
  ['main', '文档'],
  ['subdoc', '关联'],
]

function SubdocOverflow({ annotations, nodeIds }: { annotations: AnnotationRow[]; nodeIds: string[] }) {
  const activeSubdocId = useWorkbench((state) => state.activeSubdocId)
  const nodesById = useWorkbench((state) => state.nodesById)
  const setActiveSubdoc = useWorkbench((state) => state.setActiveSubdoc)
  const setAnchoredSubdocId = useWorkbench((state) => state.setAnchoredSubdocId)
  const setFocusedAnnotation = useWorkbench((state) => state.setFocusedAnnotation)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
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
    const source = annotations.find((item) => item.child_node_id === id)
    if (isSelectionSource(source)) {
      setFocusedAnnotation(source.id)
      setAnchoredSubdocId(id)
    }
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
        title={`还有 ${nodeIds.length} 个关联内容`}
        type="button"
      >
        更多 ({nodeIds.length})
      </button>
      {open && (
        <div
          aria-label="更多关联内容"
          className="subdoc-overflow-list"
          data-placement={placement}
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
        >
          {nodeIds.map((id, index) => {
            const label = nodeLabel(id, nodesById)
            const taskKey = taskKeyByTarget[id]
            const task = taskKey ? tasksByKey[taskKey] : undefined
            const badge = generationBadgeState(nodesById[id], task)
            return (
              <button
                aria-label={badge ? `${label}，${badge.label}` : label}
                aria-selected={id === activeSubdocId}
                data-gen-status={badge?.status}
                data-option-index={index}
                data-task-key={badge?.key}
                key={id}
                onClick={() => choose(index)}
                role="option"
                tabIndex={index === activeIndex ? 0 : -1}
                title={label}
                type="button"
              >
                <span className="subdoc-overflow-label">{label}</span>
                {badge && <GenerationBadge state={badge} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function nodeLabel(
  id: string | null,
  nodesById: ReturnType<typeof useWorkbench.getState>['nodesById'],
  treeTitle: string | null = null,
): string {
  if (!id) return '未选择文档'
  const node = nodesById[id]
  if (!node) return '未选择文档'
  return nodeTitle(node, treeTitle)
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
  const treeTitle = useWorkbench((state) => state.treeTitle)
  const subdocPanelTab = useWorkbench((state) => state.subdocPanelTab)
  const subdocTabs = useWorkbench((state) => state.subdocTabs)
  const [mobilePanel, setMobilePanel] = useState<WorkbenchPanel>('main')
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSessionMap, setShowSessionMap] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toastPaused, setToastPaused] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null)
  const { leftWidth, resizeSide, rightWidth, startDrag, resetSide } = useColumnResize()
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const drawerRestoreFocusRef = useRef<HTMLElement | null>(null)
  const route = useWorkbenchRoute(api)
  const subdocGroups = groupSubdocIds(subdocTabs, notesForMain)
  const overflowNodeIds = subdocPanelTab === 'global'
    ? subdocGroups.global.slice(6)
    : subdocPanelTab === 'derivations'
      ? subdocGroups.contextual.slice(6)
      : []

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

  // Cmd/Ctrl+K 打开全局搜索面板。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (treeDrawerOpen) drawerCloseRef.current?.focus()
  }, [treeDrawerOpen])

  useEffect(() => {
    if (!toast || toastPaused) return
    const timer = setTimeout(() => useWorkbench.getState().clearToast(), 8000)
    return () => clearTimeout(timer)
  }, [toast, toastPaused])

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

  function handleMobileTabsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]')
    if (!target) return
    const currentIndex = MOBILE_PANELS.findIndex(([panel]) => panel === target.dataset.panel)
    if (currentIndex < 0) return
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % MOBILE_PANELS.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + MOBILE_PANELS.length) % MOBILE_PANELS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = MOBILE_PANELS.length - 1
    else return
    event.preventDefault()
    const nextPanel = MOBILE_PANELS[nextIndex][0]
    setMobilePanel(nextPanel)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  function handleResizerKeyDown(side: ColumnSide, event: ReactKeyboardEvent<HTMLDivElement>): void {
    const current = side === 'left' ? leftWidth : rightWidth
    let next = current
    if (event.key === 'ArrowLeft') next += side === 'left' ? -10 : 10
    else if (event.key === 'ArrowRight') next += side === 'left' ? 10 : -10
    else if (event.key === 'Home') next = COLUMN_MIN_WIDTHS[side]
    else if (event.key === 'End') next = getColumnMaxWidth(side)
    else return
    event.preventDefault()
    resizeSide(side, next)
  }

  if (route.view === 'trash') {
    return <TrashPage onBack={route.openDocument} treeId={route.trashTreeId} />
  }

  return (
    <div
      className="workbench"
      data-focus={focusMode}
      data-mobile-panel={mobilePanel}
      data-testid="workbench"
      ref={setPortalRoot}
      style={{ '--col-left': leftWidth + 'px', '--col-right': rightWidth + 'px' } as React.CSSProperties}
    >
      <div aria-label="工作区面板" className="mobile-panel-tabs" onKeyDown={handleMobileTabsKeyDown} role="tablist">
        {MOBILE_PANELS.map(([panel, label]) => (
          <button
            aria-controls={`${panel}-workbench-panel`}
            aria-selected={mobilePanel === panel}
            data-panel={panel}
            key={panel}
            onClick={() => setMobilePanel(panel)}
            role="tab"
            tabIndex={mobilePanel === panel ? 0 : -1}
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
        打开笔记库
      </button>
      {treeDrawerOpen && <button aria-label="关闭笔记库导航" className="tree-drawer-backdrop" onClick={closeTreeDrawer} type="button" />}
      <aside
        aria-hidden={focusMode || undefined}
        aria-label="笔记库导航"
        className={`tree-panel${focusMode ? ' is-collapsed' : ''}${treeDrawerOpen ? ' is-drawer-open' : ''}`}
        data-testid="tree-panel"
        id="tree-workbench-panel"
      >
        <button aria-label="关闭笔记库导航" className="tree-drawer-close" onClick={closeTreeDrawer} ref={drawerCloseRef} type="button"><Icon name="close" /></button>
        <h1>本地笔记</h1>
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
            <button onClick={route.openTrash} type="button">打开回收站</button>
          </div>
        )}
      </aside>

      {!focusMode && (
        <div
          aria-orientation="vertical"
          aria-label="调整笔记库导航宽度"
          aria-valuemax={getColumnMaxWidth('left')}
          aria-valuemin={COLUMN_MIN_WIDTHS.left}
          aria-valuenow={Math.round(leftWidth)}
          className="col-resizer"
          data-side="left"
          onDoubleClick={() => resetSide('left')}
          onKeyDown={(event) => handleResizerKeyDown('left', event)}
          onMouseDown={(e) => startDrag('left', e.clientX)}
          role="separator"
          tabIndex={0}
        />
      )}

      <main aria-label="主文档" className="main-doc" data-testid="main-doc" id="main-workbench-panel">
        <Breadcrumb />
        <header className="panel-header">
          <div className="main-panel-title">
            <span className="eyebrow">笔记</span>
            <MainQuestionSummary
              contentId="main-document-question"
              text={nodeLabel(mainNodeId, nodesById, treeTitle)}
            />
            {mainNodeId && nodesById[mainNodeId] && <DocMeta node={nodesById[mainNodeId]} />}
          </div>
          <div className="header-actions">
            <button
              className="quiet-button"
              onClick={() => setPaletteOpen(true)}
              title="搜索全部笔记库（Cmd/Ctrl+K）"
              type="button"
            >
              <Icon name="search" />搜索
            </button>
            {treeId && (
              <button className="quiet-button" onClick={() => setShowSessionMap(true)} type="button">
                <Icon name="map" />会话地图
              </button>
            )}
            {mainNodeId && (
              <button className="quiet-button" onClick={() => setShowVersions((shown) => !shown)} type="button">
                <Icon name="history" />{showVersions ? '收起版本' : '版本历史'}
              </button>
            )}
            <SharePanel disabled={!mainNodeId} nodeId={mainNodeId} portal={portalRoot} />
            <button
              aria-label={focusMode ? '退出沉浸聚焦' : '进入沉浸聚焦'}
              className="quiet-button"
              onClick={() => {
                if (!focusMode) scrollMainDocumentToTop()
                toggleFocus()
              }}
              type="button"
            >
              <Icon name="focus" />{focusMode ? '退出聚焦' : '沉浸聚焦'}
            </button>
            <button className="quiet-button" onClick={() => setShowSettings((shown) => !shown)} type="button">
              <Icon name="settings" />{showSettings ? '收起设置' : '设置'}
            </button>
          </div>
        </header>
        {showSettings && <SettingsPanel />}
        {showVersions && mainNodeId && <VersionPanel nodeId={mainNodeId} />}
        <MainDoc />
      </main>
      {showSessionMap && treeId && <SessionMap onClose={() => setShowSessionMap(false)} />}
      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}

      {!focusMode && (
        <div
          aria-orientation="vertical"
          aria-label="调整关联内容宽度"
          aria-valuemax={getColumnMaxWidth('right')}
          aria-valuemin={COLUMN_MIN_WIDTHS.right}
          aria-valuenow={Math.round(rightWidth)}
          className="col-resizer"
          data-side="right"
          onDoubleClick={() => resetSide('right')}
          onKeyDown={(event) => handleResizerKeyDown('right', event)}
          onMouseDown={(e) => startDrag('right', e.clientX)}
          role="separator"
          tabIndex={0}
        />
      )}

      <section
        aria-hidden={focusMode || undefined}
        aria-label="关联内容"
        className={`subdoc-panel${focusMode ? ' is-collapsed' : ''}`}
        data-testid="subdoc-panel"
        id="subdoc-workbench-panel"
      >
        <header className="panel-header">
          <div>
            <span className="eyebrow">关联内容</span>
          </div>
        </header>
        <div className="subdoc-panel-content">
          <SubdocPanelTabs annotations={notesForMain} canCreateNote={!!mainNodeId} onCreateNote={handleCreateNote} />
          {overflowNodeIds.length > 0 && <SubdocOverflow annotations={notesForMain} nodeIds={overflowNodeIds} />}
        </div>
      </section>
      {toast && (
        <div
          aria-live={typeof toast === 'string' ? 'polite' : (toast.live ?? (toast.variant === 'error' ? 'assertive' : 'polite'))}
          className="workbench-toast"
          data-variant={typeof toast === 'string' ? 'info' : (toast.variant ?? 'info')}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setToastPaused(false)
          }}
          onFocus={() => setToastPaused(true)}
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          role={typeof toast !== 'string' && toast.variant === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true" className="toast-icon"><Icon name={typeof toast !== 'string' && toast.variant === 'error' ? 'alert' : typeof toast !== 'string' && toast.variant === 'success' ? 'check' : 'info'} size={14} /></span>
          <span>{typeof toast === 'string' ? toast : toast.message}</span>
          {typeof toast !== 'string' && toast.action && <button onClick={toast.action.onClick} type="button">{toast.action.label}</button>}
          <button aria-label="关闭提示" onClick={() => useWorkbench.getState().clearToast()} type="button"><Icon name="close" size={14} /></button>
        </div>
      )}
    </div>
  )
}
