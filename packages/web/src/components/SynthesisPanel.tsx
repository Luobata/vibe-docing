import { prosemirrorToPlainText, type DiffLine, type DocumentShareView, type NodeRow } from '@vibe/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, type SynthesisStreamHandlers } from '../api/client'
import { useApi } from '../api/context'
import { downloadMarkdown } from '../api/download'
import type { Decisions, OpenQuestion, Retrospective, Synthesis, SynthesisProgress } from '../api/types'
import { useCodeEnhancements } from '../doc/highlight-code'
import { renderMarkdown } from '../doc/markdown'
import { useWorkbench } from '../state/workbench-store'
import { Icon } from './Icon'
import { LineDiffView } from './VersionPanel'

const TABS = ['成文', '开放问题', '断点回顾', '决策日志'] as const
const STATUSES = { queued: '排队中', running: '成文中', done: '已完成', failed: '失败', cancelled: '已停止' }
const VERDICTS = { adopted: '已采纳', rejected: '已否决', superseded: '已替代' }
const running = (item?: Synthesis) => item?.status === 'queued' || item?.status === 'running'
const messageOf = (error: unknown) => error instanceof ApiError && error.payload && typeof error.payload === 'object' && 'error' in error.payload
  ? String(error.payload.error) : error instanceof Error ? error.message : '请求失败，请重试'
const labelOf = (node: Pick<NodeRow, 'id' | 'user_input'>) => prosemirrorToPlainText(node.user_input).split('\n')[0] || node.id

function MarkdownBody({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useCodeEnhancements(ref, [content])
  return <div className="doc-body synthesis-body" ref={ref} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
}

export function SynthesisPanel({ node }: { node: NodeRow }) {
  const api = useApi()
  const id = useId()
  const nodesById = useWorkbench((state) => state.nodesById)
  const treeTitle = useWorkbench((state) => state.treeTitle)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<typeof TABS[number]>('成文')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)
  const active = useRef(true)
  const controllerRef = useRef<AbortController | null>(null)
  const [records, setRecords] = useState<Synthesis[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [progress, setProgress] = useState<SynthesisProgress | null>(null)
  const [phase, setPhase] = useState('')
  const [questions, setQuestions] = useState<OpenQuestion[]>([])
  const [retrospective, setRetrospective] = useState<Retrospective | null>(null)
  const [cached, setCached] = useState(false)
  const [decisions, setDecisions] = useState<Decisions>({ merges: [], nodes: [] })
  const [verdictNodeId, setVerdictNodeId] = useState(node.id)
  const [compareId, setCompareId] = useState('')
  const [diff, setDiff] = useState<{ id: string; previousId: string; lines: DiffLine[] } | null>(null)
  const [share, setShare] = useState<{ id: string; value: DocumentShareView | null } | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const selected = records.find((item) => item.id === selectedId)
  const currentTask = records.find(running)
  const treeNodes = Object.values(nodesById).filter((item) => item.tree_id === node.tree_id && !item.is_deleted)
  const verdictNode = nodesById[verdictNodeId] ?? (node.id === verdictNodeId ? node : undefined)
  const visibleShare = share?.id === selectedId ? share.value : null

  useEffect(() => {
    active.current = true
    return () => { active.current = false; controllerRef.current?.abort() }
  }, [api, node.tree_id])
  useEffect(() => { setVerdictNodeId(node.id) }, [node.id])

  useEffect(() => {
    if (!open || busyRef.current) return
    let current = true
    setLoading(true)
    setError('')
    void Promise.allSettled([api.listSyntheses(node.tree_id), api.listOpenQuestions(node.tree_id), api.getRetrospective(node.tree_id), api.listDecisions(node.tree_id)])
      .then(([syntheses, openQuestions, recap, log]) => {
        if (!current) return
        if (syntheses.status === 'fulfilled') {
          setRecords(syntheses.value.syntheses)
          setSelectedId((previous) => syntheses.value.syntheses.some((item) => item.id === previous) ? previous : syntheses.value.syntheses[0]?.id ?? '')
        }
        if (openQuestions.status === 'fulfilled') setQuestions(openQuestions.value.questions)
        if (recap.status === 'fulfilled') setRetrospective(recap.value.retrospective)
        if (log.status === 'fulfilled') setDecisions(log.value)
        const failure = [syntheses, openQuestions, recap, log].find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') setError(`无法加载面板：${messageOf(failure.reason)}`)
        setLoading(false)
      })
    return () => { current = false }
  }, [api, node.tree_id, open])

  useEffect(() => {
    setShare(null)
    if (!open || selected?.status !== 'done') { setShareLoading(false); return }
    let current = true
    setShareLoading(true)
    void api.getSynthesisShare(selected.id).then((result) => {
      if (current) setShare({ id: selected.id, value: result.share })
    }).catch((cause) => { if (current) setError(`无法读取分享：${messageOf(cause)}`) })
      .finally(() => { if (current) setShareLoading(false) })
    return () => { current = false }
  }, [api, open, selected?.id, selected?.status])

  function accept(item: Synthesis) {
    setRecords((previous) => [item, ...previous.filter((row) => row.id !== item.id)])
    setSelectedId(item.id)
  }
  async function refresh() {
    const result = await api.listSyntheses(node.tree_id)
    if (!active.current) return
    setRecords(result.syntheses)
    setSelectedId((previous) => result.syntheses.some((item) => item.id === previous) ? previous : result.syntheses[0]?.id ?? '')
    setProgress(null)
    setPhase('')
  }
  async function action(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(label)
    setError('')
    setNotice('')
    try { await work(controller.signal) }
    catch (cause) { if (active.current && !controller.signal.aborted) setError(messageOf(cause)) }
    finally {
      if (active.current) { setBusy(null); busyRef.current = false }
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }
  async function synthesize() {
    if (currentTask || loading) return
    const previous = selected?.status === 'done' ? selected : records.find((item) => item.status === 'done')
    await action('成文', async (signal) => {
      setProgress(null)
      setPhase('正在开始…')
      setDiff(null)
      setCompareId(previous?.id ?? '')
      let finished: Synthesis | undefined
      const live = () => active.current && !signal.aborted
      const handlers: SynthesisStreamHandlers = {
        onStarted(item, total) { if (live()) { accept(item); setPhase(`正在提炼 0 / ${total} 个节点…`) } },
        onProgress(value) {
          if (!live()) return
          setProgress(value)
          setPhase('正在提炼节点…')
          setRecords((rows) => rows.map((row) => row.id === value.synthesisId ? { ...row, status: 'running' } : row))
        },
        onPhase() { if (live()) setPhase('正在综合六个章节…') },
        onDone(item) { if (live()) { finished = item; accept(item); setPhase(''); setNotice('成文已完成') } },
        onError(message, item) { if (live()) { if (item) accept(item); setError(message); setPhase('') } },
        onCancelled(item) { if (active.current) { if (item) accept(item); setNotice('已停止，重新成文可复用已完成节点'); setPhase('') } },
      }
      try { await api.synthesize(node.tree_id, handlers, signal) }
      catch (cause) {
        if (!live()) return
        if (cause instanceof ApiError && cause.status === 409 && cause.payload && typeof cause.payload === 'object'
          && 'code' in cause.payload && cause.payload.code === 'SYNTHESIS_RUNNING') {
          setNotice('已有成文任务进行中')
          setPhase('')
          if ('synthesisId' in cause.payload && typeof cause.payload.synthesisId === 'string') {
            const result = await api.getSynthesis(cause.payload.synthesisId)
            if (live()) accept(result.synthesis)
          }
        } else throw cause
      } finally {
        if (active.current) {
          try { await refresh() } catch (cause) { if (active.current) setError(`无法刷新状态：${messageOf(cause)}`) }
        }
      }
      if (finished && previous && live()) {
        const result = await api.diffSyntheses(finished.id, previous.id)
        if (live()) setDiff({ id: finished.id, previousId: previous.id, lines: result.lines })
      }
    })
  }
  async function cancel() {
    if (!currentTask || cancelling) return
    setCancelling(true)
    setError('')
    try {
      const result = await api.cancelSynthesis(currentTask.id)
      if (!active.current) return
      accept(result.synthesis)
      if (result.synthesis.status === 'cancelled') {
        if (busy === '成文') controllerRef.current?.abort()
        setNotice('已停止，重新成文可复用已完成节点')
      } else setNotice(`成文${STATUSES[result.synthesis.status]}`)
      setPhase('')
    } catch (cause) { if (active.current) setError(messageOf(cause)) }
    finally { if (active.current) setCancelling(false) }
  }
  function navigate(nodeId: string) {
    const target = useWorkbench.getState().nodesById[nodeId]
    if (target && !target.is_deleted) useWorkbench.getState().setMain(nodeId)
    else setNotice('来源节点当前不可用')
  }
  const disabled = loading || busy !== null
  const results = Object.values(selected?.nodeResults ?? {})
  const completed = progress?.synthesisId === selectedId ? progress.completed : results.length
  const total = progress?.synthesisId === selectedId ? progress.total : selected?.footnotes.length ?? 0
  const failed = progress?.synthesisId === selectedId ? progress.failed : results.filter((item) => item.status === 'failed').length
  const shareUrl = visibleShare ? new URL(visibleShare.url, window.location.origin).href : ''

  return <section aria-label="成文与讨论经营" className="synthesis-panel">
    <button type="button" className="synthesis-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} /><span>成文与讨论经营</span>
      {busy && <span className="synthesis-muted">{busy}中…</span>}
    </button>
    {open && <div className="synthesis-content" id={`${id}-panel`}>
      <nav aria-label="成文与讨论经营分区" className="synthesis-tabs">{TABS.map((name) => <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}{name === '开放问题' && questions.length > 0 ? ` (${questions.filter((item) => item.status === 'open').length})` : ''}</button>)}</nav>
      {loading && <p className="synthesis-muted" role="status">正在加载…</p>}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
      {notice && <p role="status" className="synthesis-muted">{notice}</p>}
      {tab === '成文' && <div aria-label="成文区">
        <div className="synthesis-actions">
          <button type="button" disabled={disabled || !!currentTask} onClick={() => { void synthesize() }}><Icon name="doc" />{busy === '成文' ? '正在成文…' : records.length ? '重新成文' : '一键成文'}</button>
          {currentTask && <button type="button" disabled={cancelling} onClick={() => { void cancel() }}>{cancelling ? '正在停止…' : '停止成文'}</button>}
          <button type="button" disabled={disabled} onClick={() => { void action('刷新', refresh) }}>刷新状态</button>
          {records.length > 0 && <label>历史版本 <select aria-label="成文历史" disabled={disabled} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setCompareId(''); setDiff(null); setNotice(''); setError('') }}>{records.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最新 · ' : ''}{new Date(item.createdAt).toLocaleString()} · {STATUSES[item.status]}</option>)}</select></label>}
        </div>
        {!selected && !loading && <p className="synthesis-muted">把整棵树的讨论整理为六个章节，并保留来源。</p>}
        {selected && <>
          <div className="synthesis-progress" role="status">
            <span>{phase || STATUSES[selected.status]} · 已处理 {completed} / {total} 个节点{failed > 0 ? ` · ${failed} 个失败` : ''}</span>
            {running(selected) && <progress aria-label="成文进度" max={Math.max(1, total)} value={completed} />}
            {running(selected) && busy !== '成文' && <span className="synthesis-muted">点击「刷新状态」查看最新进度。</span>}
          </div>
          {selected.error && <p className="synthesis-muted">{selected.error}</p>}
          {results.some((item) => item.cached) && <p className="synthesis-muted">已复用 {results.filter((item) => item.cached).length} 个节点</p>}
          {failed > 0 && <ul className="synthesis-list">{results.filter((item) => item.status === 'failed').map((item) => <li key={item.nodeId}>{selected.footnotes.find((note) => note.nodeId === item.nodeId)?.title ?? item.nodeId}：{item.error}</li>)}</ul>}
          {selected.contentMd && <MarkdownBody content={selected.contentMd} />}
          <div className="synthesis-actions"><button type="button" disabled={disabled || selected.status !== 'done' || !selected.contentMd} onClick={() => downloadMarkdown(selected.contentMd!, `${treeTitle || labelOf(node)} · 成文`)}>下载 .md</button></div>
          {selected.status === 'done' && <>
            {selected.footnotes.length > 0 && <details className="synthesis-sources"><summary>来源 ({selected.footnotes.length})</summary><ol>{selected.footnotes.map((note) => <li key={note.number}><button type="button" onClick={() => navigate(note.nodeId)}>[^{note.number}] {note.title}</button><span className="synthesis-muted">{note.path.join(' / ')}</span></li>)}</ol></details>}
            <div className="synthesis-actions">
              <label>对比版本 <select aria-label="对比成文版本" disabled={disabled} value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">选择历史成文</option>{records.filter((item) => item.status === 'done' && item.id !== selectedId).map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
              <button type="button" disabled={disabled || !compareId} onClick={() => { void action('对比', async () => { const result = await api.diffSyntheses(selectedId, compareId); if (active.current) setDiff({ id: selectedId, previousId: compareId, lines: result.lines }) }) }}>查看差异</button>
              {!visibleShare ? <button type="button" disabled={disabled || shareLoading} onClick={() => { void action('分享', async () => { const result = await api.createSynthesisShare(selectedId); if (active.current) setShare({ id: selectedId, value: result.share }) }) }}>{shareLoading ? '读取分享…' : '创建分享'}</button>
                : <><a href={shareUrl} target="_blank" rel="noopener noreferrer">打开分享</a><button type="button" disabled={disabled} onClick={() => { void action('复制', async () => { await navigator.clipboard.writeText(shareUrl); if (active.current) setNotice('分享链接已复制') }) }}>复制链接</button><button type="button" disabled={disabled} onClick={() => { void action('撤销', async () => { await api.revokeSynthesisShare(selectedId); if (active.current) { setShare({ id: selectedId, value: null }); setNotice('分享已撤销') } }) }}>撤销分享</button></>}
            </div>
            {visibleShare && <input className="synthesis-share-url" aria-label="成文分享链接" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />}
            {diff?.id === selectedId && diff.previousId === compareId && <LineDiffView ariaLabel="成文版本差异" title="与历史版本的差异" lines={diff.lines} />}
          </>}
        </>}
      </div>}
      {tab === '开放问题' && <div aria-label="开放问题区">
        <div className="synthesis-actions"><button type="button" disabled={disabled} onClick={() => { void action('抽取问题', async (signal) => { const result = await api.extractOpenQuestions(node.tree_id, signal); if (active.current) setQuestions(result.questions) }) }}>{busy === '抽取问题' ? '正在抽取问题…' : '抽取开放问题'}</button></div>
        {!questions.length && !loading && <p className="synthesis-muted">从当前讨论中提取仍未解决的问题。</p>}
        <ul className="synthesis-list">{questions.map((question) => <li key={question.id} className={question.status === 'resolved' ? 'synthesis-resolved' : ''}><div><span>{question.question}</span><small>{question.status === 'resolved' ? '已解决' : '待解决'}</small></div><button type="button" disabled={disabled} onClick={() => { void action('更新问题', async () => { const result = await api.updateOpenQuestion(question.id, { status: question.status === 'open' ? 'resolved' : 'open' }); if (active.current) setQuestions((items) => items.map((item) => item.id === question.id ? result.question : item)) }) }}>{question.status === 'open' ? '解决' : '重开'}</button></li>)}</ul>
      </div>}
      {tab === '断点回顾' && <div aria-label="断点回顾区">
        <div className="synthesis-actions"><button type="button" disabled={disabled} onClick={() => { void action('回顾', async (signal) => { const result = await api.createRetrospective(node.tree_id, signal); if (active.current) { setRetrospective(result.retrospective); setCached(result.cached) } }) }}>{busy === '回顾' ? '正在回顾…' : '生成回顾'}</button>{cached && <span className="synthesis-muted">已使用缓存</span>}</div>
        {retrospective ? <MarkdownBody content={retrospective.content_md} /> : !loading && <p className="synthesis-muted">回顾进展、未决问题和下一步，接着上次讨论继续。</p>}
      </div>}
      {tab === '决策日志' && <div aria-label="决策日志区">
        <div className="synthesis-actions"><label>文档 <select aria-label="决策文档" disabled={disabled} value={verdictNodeId} onChange={(event) => setVerdictNodeId(event.target.value)}>{(treeNodes.length ? treeNodes : [node]).map((item) => <option key={item.id} value={item.id}>{labelOf(item)}</option>)}</select></label>
          <label>状态 <select aria-label="文档决策状态" disabled={disabled || !verdictNode} value={verdictNode?.verdict ?? ''} onChange={(event) => { const verdict = event.target.value as keyof typeof VERDICTS | ''; void action('更新决策', async () => { const result = await api.setNodeVerdict(verdictNodeId, verdict || null); if (!active.current) return; useWorkbench.getState().upsertNode(result.node); const log = await api.listDecisions(node.tree_id); if (active.current) setDecisions(log) }) }}><option value="">未标记</option>{Object.entries(VERDICTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {!decisions.nodes.length && !decisions.merges.length && !loading && <p className="synthesis-muted">标记采纳、否决或替代的方案；已有合并记录也会显示在这里。</p>}
        <ul className="synthesis-list">{decisions.nodes.map((item) => <li key={item.id}><button type="button" onClick={() => navigate(item.id)}>{labelOf(item)}</button><span>{item.verdict ? VERDICTS[item.verdict] : ''}</span></li>)}{decisions.merges.map((merge) => <li key={merge.id}><div><strong>合并记录</strong><p>{labelOf(nodesById[merge.source_node_id] ?? { id: merge.source_node_id, user_input: null })} → {labelOf(nodesById[merge.target_node_id] ?? { id: merge.target_node_id, user_input: null })}</p><p>{merge.conclusion}</p>{merge.direction && <small>{merge.direction}</small>}</div></li>)}</ul>
      </div>}
    </div>}
  </section>
}
