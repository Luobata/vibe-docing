import { useState } from 'react'
import { useWorkbench } from '../state/workbench-store'
import { NotesTab } from './NotesTab'
import { SubdocTabs } from './SubdocTabs'

export function SubdocPanelTabs({ annotations }: {
  annotations: import('@vibe/shared').AnnotationRow[]
}) {
  const [tab, setTab] = useState<'derivations' | 'notes'>('derivations')
  const setFocusedAnnotation = useWorkbench((s) => s.setFocusedAnnotation)
  return (
    <div className="subdoc-panel-tabs">
      <div className="panel-tab-bar" role="tablist">
        <button aria-selected={tab === 'derivations'} onClick={() => setTab('derivations')} role="tab" type="button">派生分支</button>
        <button aria-selected={tab === 'notes'} onClick={() => setTab('notes')} role="tab" type="button">笔记</button>
      </div>
      {tab === 'derivations'
        ? <SubdocTabs />
        : <NotesTab annotations={annotations} onJump={(id) => setFocusedAnnotation(id)} />}
    </div>
  )
}
