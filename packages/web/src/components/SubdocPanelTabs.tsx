import { useGenerationTasks, useWorkbench } from '../state/workbench-store'
import { NotesTab } from './NotesTab'
import { SubdocTabs } from './SubdocTabs'
import { groupSubdocIds } from './subdoc-classification'

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
  const groups = groupSubdocIds(subdocTabs, annotations)
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
          {liveBranchKeys.length} 个关联内容生成中
        </div>
      )}
      <div className="panel-tab-bar" role="tablist">
        <button aria-selected={tab === 'derivations'} onClick={() => setTab('derivations')} role="tab" type="button">
          选中内容 <span className="tab-count" aria-label={`${groups.contextual.length} 个`}>{groups.contextual.length}</span>
        </button>
        <button aria-selected={tab === 'global'} onClick={() => setTab('global')} role="tab" type="button">
          整篇内容 <span className="tab-count" aria-label={`${groups.global.length} 个`}>{groups.global.length}</span>
        </button>
        <button aria-selected={tab === 'notes'} onClick={() => setTab('notes')} role="tab" type="button">
          笔记 <span className="tab-count" aria-label={`${annotations.filter((item) => item.child_node_id === null && item.note).length} 条`}>{annotations.filter((item) => item.child_node_id === null && item.note).length}</span>
        </button>
      </div>
      {tab === 'derivations' && (
        <SubdocTabs annotations={annotations} emptyLabel="还没有基于选中文本创建的关联内容" nodeIds={groups.contextual} />
      )}
      {tab === 'global' && (
        <SubdocTabs annotations={annotations} emptyLabel="还没有基于整篇笔记创建的关联内容" nodeIds={groups.global} />
      )}
      {tab === 'notes' && (
        <NotesTab annotations={annotations} canCreateNote={canCreateNote} onCreateNote={onCreateNote} onJump={(id) => setFocusedAnnotation(id)} />
      )}
    </div>
  )
}
