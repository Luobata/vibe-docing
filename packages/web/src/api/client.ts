import type {
  AnnotationKind,
  AnnotationRow,
  ContextSegmentRow,
  MergeRow,
  NodeRow,
  NodeVersionRow,
  RouteTarget,
  TreeRow,
} from '@vibe/shared'
import type { RouteConvergence } from './types'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(`HTTP ${status}`)
  }
}

export interface AnswerStreamHandlers {
  onChunk(text: string): void
  onDone(node: NodeRow): void
  onError(message: string): void
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
        'content-type': 'application/json',
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
      }
    } catch {
      handlers.onError('invalid answer stream event')
    }
  }

  return {
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
    ) =>
      json<{ annotation: AnnotationRow; childNode: NodeRow }>(
        `/nodes/${nodeId}/fork`,
        { body: JSON.stringify(body), method: 'POST' },
      ),
    getNode: (nodeId: string) =>
      json<{
        annotations: AnnotationRow[]
        node: NodeRow
        segments: ContextSegmentRow[]
      }>(`/nodes/${nodeId}`),
    getNodePath: (nodeId: string) =>
      json<{ path: NodeRow[] }>(`/nodes/${nodeId}/path`),
    getTrash: (treeId: string) =>
      json<{ nodes: NodeRow[] }>(`/trees/${treeId}/trash`),
    getTree: (treeId: string) =>
      json<{ nodes: NodeRow[]; tree: TreeRow }>(`/trees/${treeId}`),
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
    ): Promise<void> {
      const response = await fetchImpl(`${base}/nodes/${nodeId}/answer`, {
        body: JSON.stringify({ userInput }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok || !response.body) {
        throw new ApiError(response.status, await response.text())
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) handleSseFrame(frame, handlers)
        if (done) break
      }
      if (buffer.trim()) handleSseFrame(buffer, handlers)
    },
  }
}

export type Api = ReturnType<typeof createApi>
