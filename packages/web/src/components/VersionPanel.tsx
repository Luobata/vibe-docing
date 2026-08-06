import type { NodeVersionRow } from '@vibe/shared'
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'

export function VersionPanel({ nodeId }: { nodeId: string }) {
  const api = useApi()
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<NodeVersionRow[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void api.listVersions(nodeId)
      .then((result) => { if (active) setVersions(result.versions) })
      .catch(() => { if (active) setError('版本历史加载失败。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, nodeId])

  async function revert(versionNo: number): Promise<void> {
    setBusyVersion(versionNo)
    setError(null)
    try {
      const result = await api.revert(nodeId, versionNo)
      upsertNode(result.node)
    } catch {
      setError('版本回退失败。')
    } finally {
      setBusyVersion(null)
    }
  }

  if (loading) return <p aria-live="polite">正在加载版本…</p>
  return (
    <div className="version-panel">
      {versions.length === 0 ? <p className="empty-state">暂无版本快照</p> : (
        <ol>
          {versions.map((version) => (
            <li key={version.id}>
              <span>v{version.version_no} · {version.change_kind}</span>
              <button disabled={busyVersion !== null} onClick={() => { void revert(version.version_no) }} type="button">
                {busyVersion === version.version_no ? '回退中…' : '回退'}
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
