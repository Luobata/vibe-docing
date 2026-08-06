import { useState } from 'react'
import { useApi } from '../api/context'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merged, setMerged] = useState(false)

  if (merged) return <span className="merge-toast" role="status">已合并</span>
  return (
    <div className="merge-action">
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError(null)
          void api.merge(sourceNodeId, targetNodeId)
            .then(() => {
              setMerged(true)
              onMerged?.()
            })
            .catch(() => setError('合并失败，子分支仍完整保留。'))
            .finally(() => setBusy(false))
        }}
        type="button"
      >
        {busy ? '合并中…' : '合并回父节点'}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
