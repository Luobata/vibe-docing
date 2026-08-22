import { documentContentOf, legacyDocumentToMarkdown, normalizeFencedCodeBlocks, type DocumentAnchorPatch, type NodeRow, type VisualReference } from '@vibe/shared'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ApiError } from '../api/client'
import { useApi } from '../api/context'
import { renderMarkdown } from '../doc/markdown'
import { getPlainSelection, type PlainSelection } from '../doc/selection'
import { VisualBlockView } from '../components/VisualBlockView'
import type { DocumentEditorHandle, DocumentEditorProps } from './DocumentEditor'

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'
type ViewMode = 'edit' | 'preview'

const VISUAL_REFERENCE = /!\[\[vibe-visual:([^@\]|]+)@(\d+)\|([^\]]+)\]\]/g

/* ---- 围栏代码行装饰（``` 起止行含语言标记，未闭合则装饰到末行） ---- */
const codeLineDeco = Decoration.line({ class: 'cm-code-line' })
const codeFenceDeco = Decoration.line({ class: 'cm-code-line cm-code-fence' })

function buildCodeLineDecorations(view: EditorView): DecorationSet {
  const ranges: ReturnType<typeof codeLineDeco.range>[] = []
  let inFence = false
  for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo += 1) {
    const line = view.state.doc.line(lineNo)
    if (/^```/.test(line.text.trimStart())) {
      ranges.push(codeFenceDeco.range(line.from))
      inFence = !inFence
    } else if (inFence) {
      ranges.push(codeLineDeco.range(line.from))
    }
  }
  return Decoration.set(ranges)
}

const codeFenceLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildCodeLineDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = buildCodeLineDecorations(update.view)
    }
  },
  { decorations: (value) => value.decorations },
)

function sessionId(nodeId: string): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sourceFromNode(node: NodeRow): string {
  // 展示层规整：AI 生成物常见的病态围栏空行（每行之间垫空行）在加载时即修复显示；
  // 仅命中病态模式的围栏会被改动，正常代码块逐字保留。用户编辑保存后落盘为规整版。
  return normalizeFencedCodeBlocks(
    legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0),
  )
}

function anchorPatches(source: string, annotations: DocumentEditorProps['annotations']): DocumentAnchorPatch[] {
  const patches: DocumentAnchorPatch[] = []
  for (const annotation of annotations) {
    if (annotation.anchor_from === null && annotation.anchor_to === null) continue
    const quote = annotation.quoted_text ?? ''
    let from = annotation.anchor_from ?? 0
    let to = annotation.anchor_to ?? from
    if (!quote || source.slice(from, to) !== quote) {
      const first = quote ? source.indexOf(quote) : -1
      if (first < 0 || source.indexOf(quote, first + 1) >= 0) {
        patches.push({ from: null, id: annotation.id, quotedText: quote || null, status: 'orphaned', to: null })
        continue
      }
      from = first
      to = first + quote.length
    }
    patches.push({ from, id: annotation.id, quotedText: source.slice(from, to), status: 'valid', to })
  }
  return patches
}

function SaveIndicator({ state }: { state: SaveState }) {
  const labels: Record<SaveState, string> = {
    clean: '已保存', conflict: '文件冲突', dirty: '未保存', error: '保存失败', saved: '已保存', saving: '保存中…',
  }
  return <span aria-live="polite" className="document-save-state" data-state={state}>{labels[state]}</span>
}

function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) {
    return (
      <div aria-label="Markdown 预览" className="markdown-reading-view doc-body">
        <p className="empty-state">这篇笔记还是空的，切到“编辑”开始写。</p>
      </div>
    )
  }
  const parts: Array<{ key: string; source?: string; visual?: VisualReference }> = []
  let cursor = 0
  for (const match of source.matchAll(VISUAL_REFERENCE)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ key: `md-${cursor}`, source: source.slice(cursor, index) })
    parts.push({
      key: `visual-${index}`,
      visual: { altText: match[3], artifactId: match[1], revision: Number(match[2]) },
    })
    cursor = index + match[0].length
  }
  if (cursor < source.length || parts.length === 0) parts.push({ key: `md-${cursor}`, source: source.slice(cursor) })
  return (
    <div aria-label="Markdown 预览" className="markdown-reading-view doc-body">
      {parts.map((part) => part.visual
        ? <VisualBlockView key={part.key} reference={part.visual} />
        : <div dangerouslySetInnerHTML={{ __html: renderMarkdown(part.source ?? '') }} key={part.key} />)}
    </div>
  )
}

export const MarkdownEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function MarkdownEditor({
  annotations,
  disabled = false,
  errorText,
  node,
  onContextSelect,
  onRetry,
  onSaved,
  onSelect,
}, ref) {
  const api = useApi()
  const initialSource = sourceFromNode(node)
  const [source, setSource] = useState(initialSource)
  const [mode, setMode] = useState<ViewMode>(() => !initialSource.trim() || node.content_schema_version === 2 ? 'edit' : 'preview')
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const editorViewRef = useRef<EditorView | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const latestRef = useRef(source)
  const lastSavedRef = useRef(source)
  const revisionRef = useRef(node.content_revision ?? 0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const flushRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {})
  const selectionRef = useRef<PlainSelection | null>(null)
  const editSessionId = useRef(sessionId(node.id)).current
  const fileKind: 'base' | 'markdown' = node.file_kind === 'base' ? 'base' : 'markdown'

  function markChanged(value: string): void {
    setSource(value)
    latestRef.current = value
    setSaveState(value === lastSavedRef.current ? 'clean' : 'dirty')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flushRef.current().catch(() => {}) }, 750)
  }

  async function saveLatest(keepalive = false): Promise<void> {
    if (latestRef.current === lastSavedRef.current) return
    const submitted = latestRef.current
    setSaveState('saving')
    try {
      const payload = {
        anchors: anchorPatches(submitted, annotations),
        baseRevision: revisionRef.current,
        editSessionId,
        fileKind,
        schemaVersion: 2 as const,
        source: submitted,
      }
      const result = keepalive
        ? await api.saveDocumentContent(node.id, payload, { keepalive: true })
        : await api.saveDocumentContent(node.id, payload)
      revisionRef.current = result.content.revision
      lastSavedRef.current = submitted
      onSaved(result.node)
      setSaveState(latestRef.current === submitted ? 'saved' : 'dirty')
    } catch (error) {
      setSaveState(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error')
      throw error
    }
  }

  async function flush(keepalive = false): Promise<void> {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (inFlightRef.current) await inFlightRef.current.catch(() => {})
    if (latestRef.current === lastSavedRef.current) return
    const request = saveLatest(keepalive)
    inFlightRef.current = request
    try { await request } finally { if (inFlightRef.current === request) inFlightRef.current = null }
    if (latestRef.current !== lastSavedRef.current) await flush(keepalive)
  }
  flushRef.current = flush

  useImperativeHandle(ref, () => ({ flush, focus: () => editorViewRef.current?.focus() }), [])

  useEffect(() => {
    const next = sourceFromNode(node)
    if (editorViewRef.current?.hasFocus && node.status !== 'streaming') return
    setSource(next)
    latestRef.current = next
    lastSavedRef.current = next
    revisionRef.current = node.content_revision ?? revisionRef.current
    setSaveState('clean')
  }, [node.ai_response, node.document_content, node.content_revision, node.content_schema_version, node.id, node.status])

  useEffect(() => {
    const persist = () => { void flushRef.current(true).catch(() => {}) }
    const hidden = () => { if (document.visibilityState === 'hidden') persist() }
    window.addEventListener('beforeunload', persist)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('beforeunload', persist)
      document.removeEventListener('visibilitychange', hidden)
      if (timerRef.current) clearTimeout(timerRef.current)
      persist()
    }
  }, [node.id])

  async function loadServerVersion(): Promise<void> {
    setSaveState('saving')
    try {
      const result = await api.getNode(node.id)
      const next = sourceFromNode(result.node)
      setSource(next)
      latestRef.current = next
      lastSavedRef.current = next
      revisionRef.current = result.node.content_revision ?? 0
      onSaved(result.node)
      setSaveState('clean')
    } catch { setSaveState('conflict') }
  }

  function updateSelection(from: number, to: number, value = latestRef.current): void {
    if (from === to) { selectionRef.current = null; return }
    const selection = { from, text: value.slice(from, to), to }
    if (!selection.text) return
    selectionRef.current = selection
    onSelect(selection)
  }

  function capturePreviewSelection(): PlainSelection | null {
    if (mode !== 'preview' || !surfaceRef.current) return selectionRef.current
    const visible = getPlainSelection(surfaceRef.current)
    if (!visible?.text) return null

    // Reading view omits Markdown punctuation, so derive canonical source offsets
    // from the selected quote instead of treating DOM offsets as file offsets.
    const first = latestRef.current.indexOf(visible.text)
    const unique = first >= 0 && latestRef.current.indexOf(visible.text, first + 1) < 0
    const selection = unique
      ? { from: first, text: visible.text, to: first + visible.text.length }
      : visible
    selectionRef.current = selection
    onSelect(selection)
    return selection
  }

  function openSelectionMenu(event: MouseEvent<HTMLDivElement>): void {
    const selection = mode === 'preview' ? capturePreviewSelection() : selectionRef.current
    if (!selection || !onContextSelect) return
    if (event.type === 'contextmenu') event.preventDefault()
    onContextSelect(selection, event.clientX, event.clientY)
  }

  function keyboardMenu(event: KeyboardEvent<HTMLDivElement>): void {
    const shortcut = (event.key === 'F10' && event.shiftKey)
      || (event.key.toLowerCase() === 'j' && (event.metaKey || event.ctrlKey))
    const selection = selectionRef.current
    if (!shortcut || !selection || !onContextSelect) return
    event.preventDefault()
    const range = editorViewRef.current?.coordsAtPos(selection.from)
    onContextSelect(selection, range?.left ?? 0, range?.bottom ?? 0)
  }

  function replaceSelection(before: string, after = before, placeholder = '文本'): void {
    const view = editorViewRef.current
    if (!view) return
    const range = view.state.selection.main
    const selected = view.state.sliceDoc(range.from, range.to) || placeholder
    view.dispatch({
      changes: { from: range.from, insert: `${before}${selected}${after}`, to: range.to },
      selection: { anchor: range.from + before.length, head: range.from + before.length + selected.length },
    })
    view.focus()
  }

  function prefixLines(prefix: string, placeholder: string): void {
    const view = editorViewRef.current
    if (!view) return
    const range = view.state.selection.main
    const from = view.state.doc.lineAt(range.from).from
    const to = view.state.doc.lineAt(range.to).to
    const selected = view.state.sliceDoc(from, to) || placeholder
    const next = selected.split('\n').map((line) => `${prefix}${line}`).join('\n')
    view.dispatch({
      changes: { from, insert: next, to },
      selection: { anchor: from + prefix.length, head: from + next.length },
    })
    view.focus()
  }

  const readonly = disabled || node.status === 'streaming'
  return (
    <section className="document-editor markdown-editor" data-save-state={saveState} data-testid="doc-view">
      <header className="document-editor-chrome">
        <div aria-label="文档视图" className="document-view-switch" role="tablist">
          <button aria-selected={mode === 'edit'} onClick={() => setMode('edit')} role="tab" type="button">编辑</button>
          <button aria-selected={mode === 'preview'} onClick={() => setMode('preview')} role="tab" type="button">预览</button>
        </div>
        {mode === 'edit' && (
          <div aria-label="Markdown 格式" className="document-editor-toolbar" role="toolbar">
            <button aria-label="一级标题" disabled={readonly} onClick={() => prefixLines('# ', '标题')} type="button">H1</button>
            <button aria-label="粗体" disabled={readonly} onClick={() => replaceSelection('**')} type="button">B</button>
            <button aria-label="斜体" disabled={readonly} onClick={() => replaceSelection('*')} type="button">I</button>
            <button aria-label="无序列表" disabled={readonly} onClick={() => prefixLines('- ', '列表项')} type="button">• 列表</button>
            <button aria-label="任务列表" disabled={readonly} onClick={() => prefixLines('- [ ] ', '待办事项')} type="button">☐ 待办</button>
            <button aria-label="普通链接" disabled={readonly} onClick={() => replaceSelection('[', '](https://)', '链接文字')} type="button">链接</button>
            <button aria-label="内部链接" disabled={readonly} onClick={() => replaceSelection('[[', ']]', '笔记')} type="button">[[ ]]</button>
            <button aria-label="行内代码" disabled={readonly} onClick={() => replaceSelection('`')} type="button">`</button>
          </div>
        )}
        <span className="document-file-path" title={node.file_path ?? undefined}>{node.file_path ?? '正在创建本地 Markdown 文件…'}</span>
        <SaveIndicator state={saveState} />
      </header>
      {saveState === 'conflict' && (
        <div className="document-save-error" role="alert">
          <span>本地笔记文件已在其他窗口修改，当前草稿尚未覆盖它。</span>
          <div className="document-save-error-actions">
            <button onClick={() => navigator.clipboard?.writeText(latestRef.current)} type="button">复制本地草稿</button>
            <button onClick={() => { void loadServerVersion() }} type="button">加载磁盘版本</button>
          </div>
        </div>
      )}
      {saveState === 'error' && <div className="document-save-error" role="alert"><span>保存失败，草稿仍在当前页面。</span><button onClick={() => { void flush().catch(() => {}) }} type="button">重试</button></div>}
      {node.status === 'streaming' && <div className="document-readonly-notice" role="status">AI 正在生成，完成后写入本地笔记文件并恢复编辑。</div>}
      {node.status === 'error' && <div className="document-readonly-notice is-error" role="alert"><span>{errorText ?? '生成中断。'}</span>{onRetry && <button onClick={onRetry} type="button">重新生成</button>}</div>}
      <div
        className="document-editor-surface"
        onContextMenu={openSelectionMenu}
        onKeyDownCapture={keyboardMenu}
        onMouseUp={capturePreviewSelection}
        ref={surfaceRef}
      >
        {mode === 'edit' ? (
          <CodeMirror
            aria-label={fileKind === 'base' ? 'Base YAML 源码' : 'Markdown 源码'}
            basicSetup={{ bracketMatching: true, closeBrackets: true, foldGutter: false, highlightActiveLine: false, highlightSelectionMatches: false, lineNumbers: false }}
            editable={!readonly}
            extensions={[markdown(), EditorView.lineWrapping, codeFenceLinePlugin]}
            height="100%"
            onChange={(value, update) => {
              markChanged(value)
              const range = update.state.selection.main
              updateSelection(range.from, range.to, value)
            }}
            onCreateEditor={(view) => { editorViewRef.current = view }}
            onUpdate={(update) => {
              const range = update.state.selection.main
              updateSelection(range.from, range.to, update.state.doc.toString())
            }}
            placeholder={fileKind === 'base' ? '输入 Obsidian Bases YAML…' : '直接输入文字；选中文字后可用上方按钮添加标题、列表或链接。'}
            value={source}
          />
        ) : fileKind === 'base' ? (
          <div className="base-source-preview">
            <strong>Obsidian Base</strong>
            <p>当前以无损 YAML 源码编辑为主；表格、列表和卡片视图将在下一层实现。</p>
            <pre>{source}</pre>
          </div>
        ) : <MarkdownPreview source={source} />}
      </div>
    </section>
  )
})
