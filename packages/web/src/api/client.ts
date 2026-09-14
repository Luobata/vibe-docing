import type {
  AnnotationKind,
  AnnotationRow,
  ContextSegmentRow,
  CorrectDraft,
  CorrectionMode,
  DocumentShareResponse,
  DiffLine,
  DocumentAnchorPatch,
  DocumentContentView,
  MergeRow,
  NodeRow,
  NodeVersionRow,
  RouteTarget,
  TreeRow,
  VisualAnnotationTarget,
  VisualArtifact,
  VisualStreamEvent,
} from '@vibe/shared'
import { visualRuntimeStore } from '../visual/visual-stream-state'
import type { Decisions, OpenQuestion, Retrospective, RouteConvergence, SettingsPatch, SettingsView, Synthesis, SynthesisProgress } from './types'

export interface SynthesisStreamHandlers {
  onStarted(synthesis: Synthesis, total: number): void
  onProgress(progress: SynthesisProgress): void
  onPhase(): void
  onDone(synthesis: Synthesis): void
  onError(message: string, synthesis?: Synthesis): void
  onCancelled(synthesis?: Synthesis): void
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(`HTTP ${status}`)
  }
}

export interface AnswerStreamHandlers {
  onCancelled?(): void
  onChunk(text: string): void
  onDone(node: NodeRow): void
  onError(message: string): void
  onVisual?(event: VisualStreamEvent): void
}

export interface DiscussionMessage {
  id: string
  node_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  promoted_node_id: string | null
  promoted_mode: 'child' | 'section' | null
}

export type DiscussionMove = 'challenge' | 'perspectives' | 'converge'
export interface DiscussionStep { step?: number; persona?: string }
export interface DiscussionStreamHandlers {
  onChunk(text: string, step: DiscussionStep): void
  onDone(messages: DiscussionMessage[]): void
  onError(message: string, detail?: DiscussionStep & { messages?: DiscussionMessage[] }): void
  onPing?(): void
  onCancelled?(): void
}

export interface FolderRow {
  path: string
  created_at: string
}

export type ProviderConfigSource = 'settings' | 'env' | 'default' | 'unset'
export interface ProviderSettingsView extends SettingsView {
  sources: Record<'apiKey' | 'baseUrl' | 'model', ProviderConfigSource>
  sourceVars: Partial<Record<'apiKey' | 'baseUrl' | 'model', string>>
}

export type ProviderTestResult =
  | { ok: true; model: string; latencyMs: number }
  | { ok: false; code: 'invalid-config' | 'unreachable' | 'timeout' | 'auth' | 'not-found' | 'http-error'; status?: number }

export interface VersionDiffLine {
  text: string
  type: 'same' | 'add' | 'del'
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
}

export function createApi(options?: {
  base?: string
  fetchImpl?: typeof fetch
}) {
  const base = (options?.base ?? '/api').replace(/\/$/, '')
  const fetchImpl = options?.fetchImpl ?? fetch

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const raw = await response.text()
      let payload: unknown = raw
      try {
        payload = JSON.parse(raw)
      } catch {}
      throw new ApiError(response.status, payload)
    }
    return response.json() as Promise<T>
  }

  function handleSseFrame(frame: string, handlers: AnswerStreamHandlers): void {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    try {
      const event = JSON.parse(data) as Record<string, unknown>
      if (event.type === 'chunk' && typeof event.text === 'string') {
        handlers.onChunk(event.text)
      } else if (event.type === 'done' && event.node) {
        handlers.onDone(event.node as unknown as NodeRow)
      } else if (event.type === 'error') {
        handlers.onError(
          typeof event.message === 'string' ? event.message : 'answer failed',
        )
      } else if (
        ['visual_placeholder', 'visual_ready', 'visual_error'].includes(String(event.type))
        && typeof event.placeholderId === 'string'
        && typeof event.artifactId === 'string'
        && Number.isInteger(event.revision)
      ) {
        const visualEvent = event as unknown as VisualStreamEvent
        visualRuntimeStore.dispatch(visualEvent)
        handlers.onVisual?.(visualEvent)
      }
    } catch {
      handlers.onError('invalid answer stream event')
    }
  }

  async function discussionStream(path: string, body: unknown, handlers: DiscussionStreamHandlers, signal?: AbortSignal): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    const cancel = () => { void reader?.cancel(signal?.reason).catch(() => {}) }
    let terminal = false
    const frame = (source: string) => {
      const data = source.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data || terminal) return
      let event: Record<string, unknown>
      try { event = JSON.parse(data) } catch {
        terminal = true
        handlers.onError('讨论流数据无效，请重试')
        return
      }
      if (event.type === 'ping') handlers.onPing?.()
      else if (event.type === 'chunk' && typeof event.text === 'string') {
        handlers.onChunk(event.text, { step: event.step as number | undefined, persona: event.persona as string | undefined })
      } else if (event.type === 'done' && Array.isArray(event.messages)) {
        terminal = true
        handlers.onDone(event.messages as DiscussionMessage[])
      } else if (event.type === 'error') {
        terminal = true
        handlers.onError(typeof event.message === 'string' ? event.message : '讨论失败，请重试', {
          step: event.step as number | undefined, persona: event.persona as string | undefined,
          messages: Array.isArray(event.messages) ? event.messages as DiscussionMessage[] : undefined,
        })
      }
    }
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
      })
      if (!response.ok || !response.body) {
        const raw = await response.text()
        let payload: unknown = raw
        try { payload = JSON.parse(raw) } catch {}
        throw new ApiError(response.status, payload)
      }
      reader = response.body.getReader()
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      let lastActivityAt = Date.now()
      watchdog = setInterval(() => {
        if (Date.now() - lastActivityAt > 45_000) cancel()
      }, 5_000)
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        signal?.throwIfAborted()
        if (value?.byteLength) lastActivityAt = Date.now()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const entry of frames) frame(entry)
        if (done || terminal) break
      }
      signal?.throwIfAborted()
      if (buffer.trim()) frame(buffer)
      if (!terminal) handlers.onError('连接已中断，请重试')
    } catch (error) {
      if (isAbortError(error, signal)) { handlers.onCancelled?.(); return }
      throw error
    } finally {
      if (watchdog !== undefined) clearInterval(watchdog)
      signal?.removeEventListener('abort', cancel)
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  }

  async function synthesisStream(treeId: string, handlers: SynthesisStreamHandlers, signal?: AbortSignal): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let terminal = false
    const cancel = () => { void reader?.cancel(signal?.reason).catch(() => {}) }
    const frame = (source: string) => {
      const data = source.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data || terminal) return
      let event: Record<string, unknown>
      try { event = JSON.parse(data) } catch { terminal = true; handlers.onError('成文进度数据无效，请重试'); return }
      if (event.type === 'started' && event.synthesis) handlers.onStarted(event.synthesis as Synthesis, Number(event.total))
      else if (event.type === 'progress') handlers.onProgress(event as unknown as SynthesisProgress)
      else if (event.type === 'phase') handlers.onPhase()
      else if (event.type === 'done' && event.synthesis) { terminal = true; handlers.onDone(event.synthesis as Synthesis) }
      else if (event.type === 'cancelled') { terminal = true; handlers.onCancelled(event.synthesis as Synthesis | undefined) }
      else if (event.type === 'error') { terminal = true; handlers.onError(typeof event.message === 'string' ? event.message : '成文失败，请重试', event.synthesis as Synthesis | undefined) }
      // Ping frames keep the connection alive without changing visible progress.
    }
    try {
      signal?.throwIfAborted()
      const response = await fetchImpl(`${base}/trees/${treeId}/synthesize`, {
        method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, signal,
      })
      if (!response.ok || !response.body) {
        const raw = await response.text()
        let payload: unknown = raw
        try { payload = JSON.parse(raw) } catch {}
        throw new ApiError(response.status, payload)
      }
      reader = response.body.getReader()
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      let lastActivityAt = Date.now()
      watchdog = setInterval(() => { if (Date.now() - lastActivityAt > 45_000) cancel() }, 5_000)
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        signal?.throwIfAborted()
        if (value?.byteLength) lastActivityAt = Date.now()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const entry of frames) frame(entry)
        if (done || terminal) break
      }
      signal?.throwIfAborted()
      if (buffer.trim()) frame(buffer)
      if (!terminal) handlers.onError('连接已中断，刷新状态后可重新成文')
    } catch (error) {
      if (isAbortError(error, signal)) { if (!terminal) handlers.onCancelled(); return }
      throw error
    } finally {
      if (watchdog !== undefined) clearInterval(watchdog)
      signal?.removeEventListener('abort', cancel)
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  }

  return {
    synthesize: (treeId: string, handlers: SynthesisStreamHandlers, signal?: AbortSignal) => synthesisStream(treeId, handlers, signal),
    listSyntheses: (treeId: string) => json<{ syntheses: Synthesis[] }>(`/trees/${treeId}/syntheses`),
    getSynthesis: (id: string) => json<{ synthesis: Synthesis }>(`/syntheses/${id}`),
    cancelSynthesis: (id: string) => json<{ synthesis: Synthesis }>(`/syntheses/${id}/cancel`, { method: 'POST', body: '{}' }),
    diffSyntheses: (id: string, previousId: string) => json<{ lines: DiffLine[] }>(`/syntheses/${id}/diff/${previousId}`),
    getSynthesisShare: (id: string) => json<DocumentShareResponse>(`/syntheses/${id}/share`),
    createSynthesisShare: (id: string) => json<DocumentShareResponse>(`/syntheses/${id}/share`, { method: 'POST', body: '{}' }),
    revokeSynthesisShare: (id: string) => json<{ ok: true }>(`/syntheses/${id}/share`, { method: 'DELETE' }),
    listOpenQuestions: (treeId: string) => json<{ questions: OpenQuestion[] }>(`/trees/${treeId}/open-questions`),
    extractOpenQuestions: (treeId: string, signal?: AbortSignal) => json<{ questions: OpenQuestion[] }>(`/trees/${treeId}/open-questions/extract`, { method: 'POST', body: '{}', signal }),
    updateOpenQuestion: (id: string, patch: { question?: string; status?: 'open' | 'resolved' }) => json<{ question: OpenQuestion }>(`/open-questions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    getRetrospective: (treeId: string) => json<{ retrospective: Retrospective | null }>(`/trees/${treeId}/retrospective`),
    createRetrospective: (treeId: string, signal?: AbortSignal) => json<{ retrospective: Retrospective; cached: boolean }>(`/trees/${treeId}/retrospective`, { method: 'POST', body: '{}', signal }),
    listDecisions: (treeId: string) => json<Decisions>(`/trees/${treeId}/decisions`),
    setNodeVerdict: (nodeId: string, verdict: NonNullable<NodeRow['verdict']> | null) => json<{ node: NodeRow }>(`/nodes/${nodeId}/verdict`, { method: 'PATCH', body: JSON.stringify({ verdict }) }),
    listDiscussion: (nodeId: string) => json<{ messages: DiscussionMessage[] }>(`/nodes/${nodeId}/discussion`),
    sendDiscussion: (nodeId: string, userInput: string, handlers: DiscussionStreamHandlers, signal?: AbortSignal) =>
      discussionStream(`/nodes/${nodeId}/discussion`, { userInput }, handlers, signal),
    runDiscussionMove: (nodeId: string, move: DiscussionMove, handlers: DiscussionStreamHandlers, signal?: AbortSignal) =>
      discussionStream(`/nodes/${nodeId}/discussion/moves`, { move }, handlers, signal),
    promoteDiscussion: (nodeId: string, body: { mode: 'child' | 'section'; messageIds: string[]; baseRevision?: number }) =>
      json<{ node: NodeRow; content: DocumentContentView; messages: DiscussionMessage[] }>(`/nodes/${nodeId}/discussion/promote`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    listFolders: () => json<{ folders: FolderRow[] }>('/folders'),
    createFolder: (path: string) =>
      json<{ folder: FolderRow }>('/folders', {
        body: JSON.stringify({ path }),
        method: 'POST',
      }),
    removeFolder: (path: string) =>
      json<{ ok: true }>('/folders/remove', {
        body: JSON.stringify({ path }),
        method: 'POST',
      }),
    createNote: (
      nodeId: string,
      body: {
        anchorFrom: number | null
        anchorTo: number | null
        quotedText: string | null
        note: string
        visualTarget?: VisualAnnotationTarget
      },
    ) =>
      json<{ annotation: AnnotationRow }>(`/nodes/${nodeId}/annotation`, {
        body: JSON.stringify(body),
        method: 'POST',
      }),
    createTree: (title: string) =>
      json<{ rootNode: NodeRow; tree: TreeRow }>('/trees', {
        body: JSON.stringify({ title }),
        method: 'POST',
      }),
    createBlankNote: (parentNodeId: string, title: string) =>
      json<{ node: NodeRow }>(`/nodes/${parentNodeId}/children`, {
        body: JSON.stringify({ title }),
        method: 'POST',
      }),
    deleteNode: (nodeId: string) =>
      json<{ ok: true }>(`/nodes/${nodeId}`, { method: 'DELETE' }),
    deleteTree: (treeId: string) =>
      json<{ ok: true }>(`/trees/${treeId}`, { method: 'DELETE' }),
    diffVersions: (nodeId: string, from: number, to: number) =>
      json<{ diff: VersionDiffLine[] }>(`/nodes/${nodeId}/versions/${from}/diff/${to}`),
    editNode: (
      nodeId: string,
      body: { aiResponse?: string | null; userInput?: string | null },
    ) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}`, {
        body: JSON.stringify(body),
        method: 'PATCH',
      }),
    saveDocumentContent: (
      nodeId: string,
      body: ({
        anchors?: DocumentAnchorPatch[]
        baseRevision: number
        doc: import('@vibe/shared').ProseMirrorNode
        editSessionId: string
        schemaVersion: 1
      } | {
        anchors?: DocumentAnchorPatch[]
        baseRevision: number
        editSessionId: string
        fileKind: 'markdown' | 'canvas' | 'base'
        schemaVersion: 2
        source: string
      }),
      options?: { keepalive?: boolean },
    ) =>
      json<{ content: DocumentContentView; node: NodeRow }>(`/nodes/${nodeId}/content`, {
        body: JSON.stringify(body),
        keepalive: options?.keepalive,
        method: 'PATCH',
      }),
    fork: (
      nodeId: string,
      body: {
        anchorFrom?: number | null
        anchorTo?: number | null
        kind: AnnotationKind
        note?: string | null
        quotedText?: string | null
        seedText: string
        treeId: string
      },
      signal?: AbortSignal,
    ) =>
      json<{ annotation: AnnotationRow; childNode: NodeRow }>(
        `/nodes/${nodeId}/fork`,
        { body: JSON.stringify(body), method: 'POST', signal },
      ),
    getNode: (nodeId: string) =>
      json<{
        annotations: AnnotationRow[]
        node: NodeRow
        segments: ContextSegmentRow[]
      }>(`/nodes/${nodeId}`),
    getNodePath: (nodeId: string) =>
      json<{ path: NodeRow[] }>(`/nodes/${nodeId}/path`),
    getVisualArtifact: (artifactId: string, revision: number) =>
      json<{ artifact: VisualArtifact }>(`/visual-artifacts/${encodeURIComponent(artifactId)}/${revision}`),
    getSettings: (signal?: AbortSignal) =>
      json<ProviderSettingsView>('/settings', { signal }),
    testProvider: (config: { baseUrl: string; model: string; apiKey?: string }, signal?: AbortSignal) =>
      json<ProviderTestResult>('/settings/test', {
        body: JSON.stringify(config),
        method: 'POST',
        signal,
      }),
    pickDirectory: (kind: 'vault' | 'project') =>
      json<{ path: string }>('/system/pick-directory', {
        body: JSON.stringify({ kind }),
        method: 'POST',
      }),
    syncVault: () => json<{ imported: number; path: string; scanned: number }>('/vault/sync', { method: 'POST' }),
    updateSettings: (patch: SettingsPatch, signal?: AbortSignal) =>
      json<ProviderSettingsView>('/settings', {
        body: JSON.stringify(patch),
        method: 'PUT',
        signal,
      }),
    getTrash: (treeId: string) =>
      json<{ nodes: NodeRow[] }>(`/trees/${treeId}/trash`),
    search: (query: string, signal?: AbortSignal) =>
      json<{ hits: Array<{ nodeId: string; snippet: string; title: string; treeId: string; treeTitle: string }> }>(
        `/search?q=${encodeURIComponent(query)}`,
        { signal },
      ),
    moveNode: (nodeId: string, directory: string) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}/move`, {
        body: JSON.stringify({ directory }),
        method: 'POST',
      }),
    updateNodeTags: (nodeId: string, tags: string[]) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}/tags`, {
        body: JSON.stringify({ tags }),
        method: 'PUT',
      }),
    setTreeFolder: (treeId: string, folder: string | null) =>
      json<{ tree: TreeRow }>(`/trees/${treeId}`, {
        body: JSON.stringify({ folder }),
        method: 'PATCH',
      }),
    getTree: (treeId: string) =>
      json<{
        annotations: AnnotationRow[]
        merges: MergeRow[]
        nodes: NodeRow[]
        tree: TreeRow
      }>(`/trees/${treeId}`),
    getShare: (nodeId: string) =>
      json<DocumentShareResponse>(`/nodes/${nodeId}/share`),
    createShare: (nodeId: string) =>
      json<DocumentShareResponse>(`/nodes/${nodeId}/share`, { method: 'POST' }),
    revokeShare: (nodeId: string) =>
      json<{ ok: true }>(`/nodes/${nodeId}/share`, { method: 'DELETE' }),
    listDeletedTrees: () => json<{ trees: TreeRow[] }>('/trees/deleted'),
    listTrees: () => json<{ trees: TreeRow[] }>('/trees'),
    renameTree: (treeId: string, title: string) =>
      json<{ tree: TreeRow }>(`/trees/${treeId}`, {
        body: JSON.stringify({ title }),
        method: 'PATCH',
      }),
    listVersions: (nodeId: string) =>
      json<{ versions: NodeVersionRow[] }>(`/nodes/${nodeId}/versions`),
    merge: (sourceNodeId: string, targetNodeId: string) =>
      json<{ merge: MergeRow; segment: ContextSegmentRow }>(
        `/nodes/${sourceNodeId}/merge`,
        { body: JSON.stringify({ targetNodeId }), method: 'POST' },
      ),
    correct: (
      sourceNodeId: string,
      body: { direction: string; includeSubtree?: boolean; mode: CorrectionMode },
    ) =>
      json<CorrectDraft>(`/nodes/${sourceNodeId}/correct`, {
        body: JSON.stringify(body),
        method: 'POST',
      }),
    commitCorrection: (
      sourceNodeId: string,
      body: { direction: string; documentContent: string },
    ) =>
      json<{ merge: MergeRow; node: NodeRow }>(`/nodes/${sourceNodeId}/correct/commit`, {
        body: JSON.stringify(body),
        method: 'POST',
      }),
    migrate: (
      nodeId: string,
      body: { newParentId: string; seedText?: string; target: RouteTarget },
    ) =>
      json<{ node: NodeRow; path: NodeRow[] }>(`/nodes/${nodeId}/migrate`, {
        body: JSON.stringify(body),
        method: 'POST',
      }),
    restoreNode: (nodeId: string) =>
      json<{ ok: true }>(`/nodes/${nodeId}/restore`, { method: 'POST' }),
    restoreTree: (treeId: string) =>
      json<{ tree: TreeRow }>(`/trees/${treeId}/restore`, { method: 'POST' }),
    revert: (nodeId: string, versionNo: number) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}/versions/${versionNo}/revert`, {
        method: 'POST',
      }),
    route: (answerNodeId: string) =>
      json<RouteConvergence>(`/nodes/${answerNodeId}/route`, { method: 'POST' }),
    async streamAnswer(
      nodeId: string,
      userInput: string,
      handlers: AnswerStreamHandlers,
      signal?: AbortSignal,
    ): Promise<void> {
      let detachAbort: (() => void) | undefined
      let watchdog: ReturnType<typeof setInterval> | undefined
      try {
        const response = await fetchImpl(`${base}/nodes/${nodeId}/answer`, {
          body: JSON.stringify({ userInput }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal,
        })
        if (!response.ok || !response.body) {
          throw new ApiError(response.status, await response.text())
        }

        const reader = response.body.getReader()
        const cancelReader = (): void => {
          void reader.cancel(signal?.reason).catch(() => {})
        }
        signal?.addEventListener('abort', cancelReader, { once: true })
        detachAbort = () => signal?.removeEventListener('abort', cancelReader)
        if (signal?.aborted) cancelReader()

        let lastActivityAt = Date.now()
        watchdog = setInterval(() => {
          if (Date.now() - lastActivityAt > 45_000) {
            void reader.cancel().catch(() => {})
          }
        }, 5_000)
        let sawDone = false
        let sawError = false
        const streamHandlers: AnswerStreamHandlers = {
          ...handlers,
          onDone(node) {
            sawDone = true
            handlers.onDone(node)
          },
          onError(message) {
            sawError = true
            handlers.onError(message)
          },
        }
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          signal?.throwIfAborted()
          const { done, value } = await reader.read()
          signal?.throwIfAborted()
          if (value?.byteLength) lastActivityAt = Date.now()
          buffer += decoder.decode(value, { stream: !done })
          const frames = buffer.split(/\r?\n\r?\n/)
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            signal?.throwIfAborted()
            handleSseFrame(frame, streamHandlers)
          }
          if (done) break
        }
        signal?.throwIfAborted()
        if (buffer.trim()) handleSseFrame(buffer, streamHandlers)
        if (!sawDone && !sawError) handlers.onError('连接已中断，请重试')
      } catch (error) {
        if (isAbortError(error, signal)) {
          handlers.onCancelled?.()
          return
        }
        throw error
      } finally {
        if (watchdog !== undefined) clearInterval(watchdog)
        detachAbort?.()
      }
    },
  }
}

export type Api = ReturnType<typeof createApi>
