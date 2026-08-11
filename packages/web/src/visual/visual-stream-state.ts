import type { VisualArtifact, VisualStreamEvent } from '@vibe/shared'

export type VisualRuntimeEntry =
  | { status: 'loading'; placeholderId: string; artifactId: string; revision: number }
  | { status: 'ready'; placeholderId: string; artifactId: string; revision: number; artifact: VisualArtifact }
  | { status: 'error'; placeholderId: string; artifactId: string; revision: number; reason: string; retryable: boolean }

export type VisualRuntimeState = Record<string, VisualRuntimeEntry>

/** Merge by placeholder, rejecting any late event older than its current revision. */
export function reduceVisualStream(state: VisualRuntimeState, event: VisualStreamEvent): VisualRuntimeState {
  const current = state[event.placeholderId]
  if (current && event.revision < current.revision) return state
  const nextStatus = event.type === 'visual_placeholder' ? 'loading' : event.type === 'visual_ready' ? 'ready' : 'error'
  const rank = { loading: 0, error: 1, ready: 2 } as const
  if (current && event.revision === current.revision && rank[nextStatus] < rank[current.status]) return state
  const base = { placeholderId: event.placeholderId, artifactId: event.artifactId, revision: event.revision }
  const next: VisualRuntimeEntry = event.type === 'visual_placeholder'
    ? { ...base, status: 'loading' }
    : event.type === 'visual_ready'
      ? { ...base, status: 'ready', artifact: event.artifact }
      : { ...base, status: 'error', reason: event.reason, retryable: false }
  return { ...state, [event.placeholderId]: next }
}

const listeners = new Set<() => void>()
let state: VisualRuntimeState = {}
export const visualRuntimeStore = {
  getSnapshot: () => state,
  dispatch(event: VisualStreamEvent) {
    state = reduceVisualStream(state, event)
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  reset() {
    state = {}
    listeners.forEach((listener) => listener())
  },
}
