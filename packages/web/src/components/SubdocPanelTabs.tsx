import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { NotesTab } from './NotesTab'
import { SubdocTabs } from './SubdocTabs'

export function SubdocPanelTabs({ annotations, onCreateNote, canCreateNote }: {
  annotations: import('@vibe/shared').AnnotationRow[]
  onCreateNote(note: string): void
  canCreateNote: boolean
}) {
  const tab = useWorkbench((s) => s.subdocPanelTab)
  const setTab = useWorkbench((s) => s.setSubdocPanelTab)
  const setFocusedAnnotation = useWorkbench((s) => s.setFocusedAnnotation)
  const subdocTabs = useWorkbench((s) => s.subdocTabs)
  const tasksByKey = useGenerationTasks((snapshot) => snapshot.byKey)
  const taskKeyByTarget = useGenerationTasks((snapshot) => snapshot.byTarget)
  const liveBranchKeys = subdocTabs.flatMap((nodeId) => {
    const key = taskKeyByTarget[nodeId]
    return key && tasksByKey[key]?.status === 'streaming' ? [key] : []
  })
  return (
    <div className="subdoc-panel-tabs">
      {liveBranchKeys.length > 0 && (
        <div
          aria-live="polite"
          className="subdoc-generation-summary"
          data-gen-status="streaming"
          data-task-key={liveBranchKeys.join(' ')}
          role="status"
        >
          {liveBranchKeys.length} 个分支生成中
        </div>
      )}
      <div className="panel-tab-bar" role="tablist">
        <button aria-selected={tab === 'derivations'} onClick={() => setTab('derivations')} role="tab" type="button">
          派生分支 <span className="tab-count" aria-label={`${subdocTabs.length} 个`}>{subdocTabs.length}</span>
        </button>
        <button aria-selected={tab === 'notes'} onClick={() => setTab('notes')} role="tab" type="button">
          笔记 <span className="tab-count" aria-label={`${annotations.filter((item) => item.child_node_id === null && item.note).length} 条`}>{annotations.filter((item) => item.child_node_id === null && item.note).length}</span>
        </button>
      </div>
      {tab === 'derivations'
        ? <SubdocTabs annotations={annotations} />
        : <NotesTab annotations={annotations} canCreateNote={canCreateNote} onCreateNote={onCreateNote} onJump={(id) => setFocusedAnnotation(id)} />}
    </div>
  )
}
