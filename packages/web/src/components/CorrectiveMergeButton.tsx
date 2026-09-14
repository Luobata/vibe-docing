import {
  documentContentOf,
  legacyDocumentToMarkdown,
  lineDiff,
  type DiffLine,
  type CorrectDraft,
  type CorrectionMode,
  type CorrectionPatchPair,
} from '@vibe/shared'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { LineDiffView } from './VersionPanel'

interface AppliedPair extends CorrectionPatchPair {
  matched: boolean
}

export interface AppliedCorrection {
  content: string
  pairs: AppliedPair[]
}

export function applyCorrectionPairs(
  source: string,
  pairs: CorrectionPatchPair[],
  heading = '纠正附注',
): AppliedCorrection {
  let content = source
  const applied = pairs.map((pair) => {
    const index = content.indexOf(pair.quote)
    if (index < 0) return { ...pair, matched: false }
    content = `${content.slice(0, index)}${pair.replacement}${content.slice(index + pair.quote.length)}`
    return { ...pair, matched: true }
  })
  const unmatched = applied.filter((pair) => !pair.matched)
  if (unmatched.length > 0) {
    const notes = unmatched.map((pair) => pair.replacement || `未找到需删除的原文：“${pair.quote}”`)
    const separator = !content || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
    content = `${content}${separator}## ${heading}\n\n${notes.join('\n\n')}`
  }
  return { content, pairs: applied }
}

export function appendMergeSection(
  source: string,
  section: { body: string; title: string },
): string {
  const separator = !source || source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n'
  return `${source}${separator}## ${section.title}\n\n${section.body}`
}

interface Preview {
  appliedPairs: AppliedPair[]
  content: string
  draft: CorrectDraft
  lines: DiffLine[]
}

const PROVIDER_CONFIG_ERROR_MESSAGE = 'AI 服务商配置不受支持（仅支持 codex），请在设置中修正'

function isProviderConfigError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 503) return false
  const payload = error.payload
  return typeof payload === 'object'
    && payload !== null
    && !Array.isArray(payload)
    && (payload as Record<string, unknown>).code === 'PROVIDER_CONFIG'
}

export function CorrectiveMergeButton({
  compact = false,
  sourceNodeId,
  targetNodeId,
}: {
  compact?: boolean
  sourceNodeId: string
  targetNodeId: string
}) {
  const api = useApi()
  const upsertNode = useWorkbench((state) => state.upsertNode)
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState('')
  const [includeSubtree, setIncludeSubtree] = useState(true)
  const [mode, setMode] = useState<CorrectionMode>('patch')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<'draft' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const directionRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    directionRef.current?.focus()
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  function close(): void {
    if (busy) return
    setOpen(false)
    setTimeout(() => triggerRef.current?.focus(), 0)
  }

  function configure(): void {
    setDirection('')
    setIncludeSubtree(true)
    setMode('patch')
    setPreview(null)
    setBusy(null)
    setError(null)
    setOpen(true)
  }

  function invalidatePreview(): void {
    setPreview(null)
    setError(null)
  }

  async function generateDraft(): Promise<void> {
    const normalizedDirection = direction.trim()
    if (!normalizedDirection || busy) return
    setBusy('draft')
    setError(null)
    try {
      // Hydrating the parent first keeps file-backed Markdown and the provider
      // prompt on the same source text before exact quote matching begins.
      const target = await api.getNode(targetNodeId)
      const draft = await api.correct(sourceNodeId, {
        direction: normalizedDirection,
        includeSubtree,
        mode,
      })
      const base = legacyDocumentToMarkdown(
        documentContentOf(target.node),
        target.node.content_schema_version ?? 0,
      )
      if (draft.mode === 'patch') {
        const applied = applyCorrectionPairs(base, draft.pairs, draft.unmatched.heading)
        setPreview({
          appliedPairs: applied.pairs,
          content: applied.content,
          draft,
          lines: lineDiff(base, applied.content),
        })
      } else if (draft.mode === 'append') {
        const content = appendMergeSection(base, draft.section)
        setPreview({
          appliedPairs: [],
          content,
          draft,
          lines: lineDiff(base, content),
        })
      } else {
        setPreview({
          appliedPairs: [],
          content: draft.fullText,
          draft,
          lines: lineDiff(base, draft.fullText),
        })
      }
    } catch (cause) {
      setError(isProviderConfigError(cause)
        ? PROVIDER_CONFIG_ERROR_MESSAGE
        : '合并草案生成失败，父文档尚未修改。')
    } finally {
      setBusy(null)
    }
  }

  async function commit(): Promise<void> {
    if (!preview || busy) return
    setBusy('commit')
    setError(null)
    try {
      const result = await api.commitCorrection(sourceNodeId, {
        direction: direction.trim(),
        documentContent: preview.content,
      })
      upsertNode(result.node)
      const workbench = useWorkbench.getState()
      workbench.setTreeGraph({ merges: [...workbench.treeMerges, result.merge] })
      workbench.bumpMergeRefresh()
      setOpen(false)
      setTimeout(() => triggerRef.current?.focus(), 0)
    } catch (cause) {
      setError(isProviderConfigError(cause)
        ? PROVIDER_CONFIG_ERROR_MESSAGE
        : '合并采纳失败，父文档仍保持原样。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="merge-action" style={compact ? { marginTop: 0 } : undefined}>
      <button data-testid="corrective-merge-trigger" onClick={configure} ref={triggerRef} type="button">按说明合并到父文档</button>
      {open && (
        <dialog
          aria-labelledby={`${id}-title`}
          aria-modal="true"
          className="confirm-dialog"
          onCancel={(event) => { event.preventDefault(); close() }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            close()
          }}
          ref={dialogRef}
          style={{ width: 'min(760px, calc(100vw - 32px))' }}
        >
          <div className="confirm-dialog-content" style={{ display: 'grid', gap: 14, maxHeight: 'min(82vh, 760px)', overflow: 'auto' }}>
            <h2 id={`${id}-title`}>按说明合并到父文档</h2>
            <label style={{ display: 'grid', gap: 6 }}>
              <strong>合并说明</strong>
              <textarea
                aria-label="合并说明"
                data-testid="instruction-input"
                disabled={busy !== null}
                onChange={(event) => { setDirection(event.target.value); invalidatePreview() }}
                placeholder="例如：按验证优先方向纠正 / 提炼分支要点补充 / 整理为下一步建议"
                ref={directionRef}
                rows={3}
                value={direction}
              />
            </label>
            <fieldset disabled={busy !== null} style={{ border: 0, display: 'flex', gap: 16, margin: 0, padding: 0 }}>
              <legend style={{ marginBottom: 6 }}>生成方式</legend>
              <label><input checked={mode === 'patch'} data-testid="mode-patch" name={`${id}-mode`} onChange={() => { setMode('patch'); invalidatePreview() }} type="radio" /> 定向修订</label>
              <label><input checked={mode === 'append'} data-testid="mode-append" name={`${id}-mode`} onChange={() => { setMode('append'); invalidatePreview() }} type="radio" /> 追加合并说明</label>
              <label><input checked={mode === 'rewrite'} data-testid="mode-rewrite" name={`${id}-mode`} onChange={() => { setMode('rewrite'); invalidatePreview() }} type="radio" /> 整篇重写</label>
            </fieldset>
            <label>
              <input
                checked={includeSubtree}
                disabled={busy !== null}
                onChange={(event) => { setIncludeSubtree(event.target.checked); invalidatePreview() }}
                type="checkbox"
              /> 包含此分支的递归子树证据
            </label>
            <button data-testid="generate" disabled={!direction.trim() || busy !== null} onClick={() => { void generateDraft() }} type="button">
              {busy === 'draft' ? '生成中…' : preview ? '重新生成草案' : '生成合并草案'}
            </button>

            {preview?.draft.mode === 'patch' && (
              <section aria-label="定向补丁草案" style={{ display: 'grid', gap: 10 }}>
                <strong>定向补丁草案</strong>
                {preview.appliedPairs.map((pair, index) => (
                  <div key={`${index}-${pair.quote}`}>
                    {!pair.matched && (
                      <p className="notice notice-info" role="status">原文未匹配，将在文末“纠正附注”追加。</p>
                    )}
                    <LineDiffView
                      ariaLabel={`替换对 ${index + 1}`}
                      lines={[
                        { text: pair.quote, type: 'del' },
                        { text: pair.replacement, type: 'add' },
                      ]}
                      title={`替换对 ${index + 1}${pair.matched ? '' : '（未匹配）'}`}
                    />
                  </div>
                ))}
              </section>
            )}
            {preview?.draft.mode === 'rewrite' && (
              <LineDiffView ariaLabel="整篇重写变化" lines={preview.lines} title="父文档 → 整篇重写草案" />
            )}
            {preview?.draft.mode === 'append' && (
              <section aria-label="追加合并说明草案" style={{ display: 'grid', gap: 10 }}>
                <strong>将追加的新节</strong>
                <h3 style={{ margin: 0 }}>{preview.draft.section.title}</h3>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{preview.draft.section.body}</p>
                <LineDiffView ariaLabel="文末追加变化" lines={preview.lines} title="父文档 → 文末追加新节" />
              </section>
            )}
            {error && <p className="inline-error" role="alert">{error}</p>}
            <div className="confirm-dialog-actions">
              <button className="quiet-button" disabled={busy !== null} onClick={close} type="button">取消</button>
              {preview && (
                <button className="primary-button" data-testid="adopt" disabled={busy !== null} onClick={() => { void commit() }} type="button">
                  {busy === 'commit' ? '采纳中…' : '采纳合并'}
                </button>
              )}
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
