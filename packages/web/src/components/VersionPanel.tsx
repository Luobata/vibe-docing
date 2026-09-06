import type { NodeVersionRow } from '@vibe/shared'
import { useEffect, useRef, useState } from 'react'
import type { VersionDiffLine } from '../api/client'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { ConfirmDialog } from './ConfirmDialog'

export function VersionPanel({ nodeId }: { nodeId: string }) {
  const api = useApi()
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const correctionRefreshTick = useWorkbench((state) => state.mergeRefreshTick)
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<NodeVersionRow[]>([])
  const [pendingVersion, setPendingVersion] = useState<NodeVersionRow | null>(null)
  const [diffVersion, setDiffVersion] = useState<number | null>(null)
  const [diffLines, setDiffLines] = useState<VersionDiffLine[]>([])
  const [diffLoading, setDiffLoading] = useState<number | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void api.listVersions(nodeId)
      .then((result) => { if (active) setVersions(result.versions) })
      .catch(() => { if (active) setError('版本历史加载失败。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, correctionRefreshTick, nodeId])

  async function revert(versionNo: number): Promise<void> {
    setBusyVersion(versionNo)
    setError(null)
    try {
      const result = await api.revert(nodeId, versionNo)
      upsertNode(result.node)
      useWorkbench.getState().setToast({
        message: `已恢复版本 ${versionNo}，恢复前内容仍保留在版本历史中。`,
        variant: 'success',
      })
      setPendingVersion(null)
    } catch {
      setError('版本回退失败。')
    } finally {
      setBusyVersion(null)
    }
  }

  async function showDiff(versionNo: number, currentVersionNo: number): Promise<void> {
    if (diffVersion === versionNo) {
      setDiffVersion(null)
      setDiffLines([])
      setDiffError(null)
      return
    }
    setDiffVersion(versionNo)
    setDiffLoading(versionNo)
    setDiffLines([])
    setDiffError(null)
    try {
      const result = await api.diffVersions(nodeId, versionNo, currentVersionNo)
      setDiffLines(result.diff)
    } catch {
      setDiffError('变化对比加载失败。')
    } finally {
      setDiffLoading(null)
    }
  }

  if (loading) return <p aria-live="polite">正在加载版本…</p>
  const ordered = [...versions].sort((left, right) => right.version_no - left.version_no)
  const currentVersionNo = ordered[0]?.version_no
  return (
    <div className="version-panel">
      <div className="version-panel-heading">
        <strong>版本历史</strong>
        <span>恢复不会删除已有版本</span>
      </div>
      {versions.length === 0 ? <p className="empty-state">暂无版本快照</p> : (
        <ol>
          {ordered.map((version) => (
            <li key={version.id}>
              <span className="version-panel-meta">
                <strong>版本 {version.version_no}</strong>
                <span>{changeKindLabel(version.change_kind)} · {formatVersionTime(version.created_at)}</span>
              </span>
              <span className="version-panel-actions">
                {version.version_no !== currentVersionNo && currentVersionNo !== undefined && (
                  <button
                    aria-expanded={diffVersion === version.version_no}
                    disabled={diffLoading !== null}
                    onClick={() => { void showDiff(version.version_no, currentVersionNo) }}
                    type="button"
                  >
                    {diffLoading === version.version_no ? '对比中…' : diffVersion === version.version_no ? '收起变化' : '查看变化'}
                  </button>
                )}
                <button
                  disabled={busyVersion !== null || version.version_no === currentVersionNo}
                  onClick={(event) => {
                    restoreTriggerRef.current = event.currentTarget
                    setPendingVersion(version)
                  }}
                  type="button"
                >
                  {version.version_no === currentVersionNo ? '当前版本' : '恢复此版本'}
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {diffVersion !== null && (
        <LineDiffView
          ariaLabel={`版本 ${diffVersion} 的变化`}
          error={diffError}
          lines={diffLines}
          loading={diffLoading === diffVersion}
          title={`版本 ${diffVersion} → 当前版本`}
        />
      )}
      {error && !pendingVersion && <p role="alert">{error}</p>}
      {pendingVersion && (
        <ConfirmDialog
          busy={busyVersion === pendingVersion.version_no}
          busyLabel="恢复中…"
          confirmLabel="确认恢复"
          error={error}
          message={`将用版本 ${pendingVersion.version_no} 的内容替换当前正文。恢复前的内容会作为新版本保留，可继续找回。`}
          onCancel={() => {
            setError(null)
            setPendingVersion(null)
          }}
          onConfirm={() => revert(pendingVersion.version_no)}
          returnFocusTo={restoreTriggerRef.current}
          title={`恢复版本 ${pendingVersion.version_no}？`}
        />
      )}
    </div>
  )
}

export function LineDiffView({
  ariaLabel,
  error,
  lines,
  loading = false,
  title,
}: {
  ariaLabel: string
  error?: string | null
  lines: VersionDiffLine[]
  loading?: boolean
  title: string
}) {
  return (
    <section aria-live="polite" className="version-diff">
      <header>
        <strong>{title}</strong>
        <span>绿色为新增，红色为删除</span>
      </header>
      {loading ? <p>正在对比…</p> : error ? <p role="alert">{error}</p> : (
        <pre aria-label={ariaLabel}>
          {lines.map((line, index) => <span data-type={line.type} key={`${index}-${line.type}`}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '− ' : '  '}{line.text || ' '}{'\n'}</span>)}
        </pre>
      )}
    </section>
  )
}

const CHANGE_KIND_LABELS: Record<NodeVersionRow['change_kind'], string> = {
  correction: '引导合并',
  edit: '编辑保存',
  merge: '合并内容',
  regenerate: '重新生成',
}

function changeKindLabel(kind: NodeVersionRow['change_kind']): string {
  return CHANGE_KIND_LABELS[kind]
}

function formatVersionTime(value: string): string {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}
