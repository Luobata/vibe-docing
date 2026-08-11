import type {
  AnnotationKind,
  AnnotationRow,
  ContextSegmentRow,
  DocumentShareResponse,
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
import type { RouteConvergence, SettingsPatch, SettingsView } from './types'

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

  return {
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
    deleteNode: (nodeId: string) =>
      json<{ ok: true }>(`/nodes/${nodeId}`, { method: 'DELETE' }),
    deleteTree: (treeId: string) =>
      json<{ ok: true }>(`/trees/${treeId}`, { method: 'DELETE' }),
    diffVersions: (nodeId: string, from: number, to: number) =>
      json<{ diff: unknown }>(`/nodes/${nodeId}/versions/${from}/diff/${to}`),
    editNode: (
      nodeId: string,
      body: { aiResponse?: string | null; userInput?: string | null },
    ) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}`, {
        body: JSON.stringify(body),
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
      json<SettingsView>('/settings', { signal }),
    updateSettings: (patch: SettingsPatch, signal?: AbortSignal) =>
      json<SettingsView>('/settings', {
        body: JSON.stringify(patch),
        method: 'PUT',
        signal,
      }),
    getTrash: (treeId: string) =>
      json<{ nodes: NodeRow[] }>(`/trees/${treeId}/trash`),
    getTree: (treeId: string) =>
      json<{ nodes: NodeRow[]; tree: TreeRow }>(`/trees/${treeId}`),
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

        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          signal?.throwIfAborted()
          const { done, value } = await reader.read()
          signal?.throwIfAborted()
          buffer += decoder.decode(value, { stream: !done })
          const frames = buffer.split(/\r?\n\r?\n/)
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            signal?.throwIfAborted()
            handleSseFrame(frame, handlers)
          }
          if (done) break
        }
        signal?.throwIfAborted()
        if (buffer.trim()) handleSseFrame(buffer, handlers)
      } catch (error) {
        if (isAbortError(error, signal)) {
          handlers.onCancelled?.()
          return
        }
        throw error
      } finally {
        detachAbort?.()
      }
    },
  }
}

export type Api = ReturnType<typeof createApi>
