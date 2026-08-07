import { useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'

export function MergeButton({
  onMerged,
  sourceNodeId,
  targetNodeId,
}: {
  onMerged?(): void
  sourceNodeId: string
  targetNodeId: string
}) {
  const api = useApi()
  const mergeState = useWorkbench((s) => s.mergeStateByNodeId[sourceNodeId])
  const setMergeState = useWorkbench((s) => s.setMergeState)
  const [error, setError] = useState<string | null>(null)

  if (mergeState === 'merged') return <span className="merge-toast" role="status">已合并</span>
  const busy = mergeState === 'merging'
  return (
    <div className="merge-action">
      <button
        disabled={busy}
        onClick={() => {
          setMergeState(sourceNodeId, 'merging')
          setError(null)
          void api.merge(sourceNodeId, targetNodeId)
            .then(() => {
              setMergeState(sourceNodeId, 'merged')
              onMerged?.()
            })
            .catch(() => {
              setMergeState(sourceNodeId, null)
              setError('合并失败，子分支仍完整保留。')
            })
        }}
        type="button"
      >
        {busy ? '合并中…' : '合并回父节点'}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
