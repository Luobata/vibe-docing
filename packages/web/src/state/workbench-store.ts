import type { AnnotationRow, NodeRow, NodeVersionRow } from '@vibe/shared'
import { useSyncExternalStore } from 'react'
import type { RouteConvergence } from '../api/types'

export type GenerationTaskKind = 'ask' | 'edit' | 'fork-expand' | 'retry'
export type GenerationTaskPhase = 'replying' | 'stopping' | 'thinking'
export type GenerationTaskStatus = 'cancelled' | 'complete' | 'error' | 'streaming'

export interface GenerationTask {
  readonly controller: AbortController
  readonly error: string | null
  readonly fallbackTimer: ReturnType<typeof setTimeout> | null
  readonly key: string
  readonly kind: GenerationTaskKind
  readonly onCancelled?: () => void
  readonly ownerMainNodeId: string
  readonly phase: GenerationTaskPhase
  readonly runId: number
  readonly status: GenerationTaskStatus
  readonly targetNodeId: string | null
}

export interface GenerationTaskRegistrySnapshot {
  readonly byKey: Readonly<Record<string, GenerationTask>>
  readonly byTarget: Readonly<Record<string, string>>
}

interface StartGenerationTaskInput {
  key: string
  kind: GenerationTaskKind
  onCancelled?: () => void
  ownerMainNodeId: string
  targetNodeId?: string | null
}

type GenerationListener = () => void

const EMPTY_GENERATION_SNAPSHOT: GenerationTaskRegistrySnapshot = Object.freeze({
  byKey: Object.freeze({}),
  byTarget: Object.freeze({}),
})
const generationListeners = new Set<GenerationListener>()
let generationSnapshot = EMPTY_GENERATION_SNAPSHOT
let nextGenerationRunId = 1

function publishGenerationSnapshot(next: GenerationTaskRegistrySnapshot): void {
  generationSnapshot = Object.freeze({
    byKey: Object.freeze(next.byKey),
    byTarget: Object.freeze(next.byTarget),
  })
  for (const listener of generationListeners) listener()
}

function currentGenerationTask(task: GenerationTask): GenerationTask | undefined {
  const current = generationSnapshot.byKey[task.key]
  return current?.runId === task.runId ? current : undefined
}

function resetGenerationTasks(): void {
  const tasks = Object.values(generationSnapshot.byKey)
  generationSnapshot = EMPTY_GENERATION_SNAPSHOT
  for (const listener of generationListeners) listener()
  for (const task of tasks) {
    if (task.fallbackTimer) clearTimeout(task.fallbackTimer)
    if (!task.controller.signal.aborted) task.controller.abort()
  }
}

export const generationTaskKeys = {
  ask: (mainNodeId: string) => `ask:${mainNodeId}`,
  edit: (turnNodeId: string) => `edit:${turnNodeId}`,
  forkExpand: (
    sourceNodeId: string,
    anchorFrom: number | 'whole',
    anchorTo: number | 'whole',
  ) => `fork-expand:${sourceNodeId}:${anchorFrom}:${anchorTo}`,
  retry: (targetNodeId: string) => `retry:${targetNodeId}`,
} as const

export const generationTaskRegistry = {
  getSnapshot(): GenerationTaskRegistrySnapshot {
    return generationSnapshot
  },
  isTaskCurrent(task: GenerationTask): boolean {
    return currentGenerationTask(task) !== undefined
  },
  isTaskLive(task: GenerationTask): boolean {
    const current = currentGenerationTask(task)
    return current?.status === 'streaming' && !current.controller.signal.aborted
  },
  patchPhase(task: GenerationTask, phase: GenerationTaskPhase): boolean {
    const current = currentGenerationTask(task)
    if (!current || current.status !== 'streaming' || current.controller.signal.aborted) return false
    publishGenerationSnapshot({
      ...generationSnapshot,
      byKey: {
        ...generationSnapshot.byKey,
        [task.key]: { ...current, phase },
      },
    })
    return true
  },
  reset(): void {
    resetGenerationTasks()
  },
  setTarget(task: GenerationTask, targetNodeId: string): boolean {
    const current = currentGenerationTask(task)
    if (!current || current.status !== 'streaming' || current.controller.signal.aborted) return false
    const conflictingKey = generationSnapshot.byTarget[targetNodeId]
    const conflictingTask = conflictingKey ? generationSnapshot.byKey[conflictingKey] : undefined
    if (conflictingTask && conflictingTask.runId !== task.runId && conflictingTask.status === 'streaming') {
      return false
    }
    const byTarget = { ...generationSnapshot.byTarget }
    if (current.targetNodeId && byTarget[current.targetNodeId] === task.key) {
      delete byTarget[current.targetNodeId]
    }
    byTarget[targetNodeId] = task.key
    publishGenerationSnapshot({
      byKey: {
        ...generationSnapshot.byKey,
        [task.key]: { ...current, targetNodeId },
      },
      byTarget,
    })
    return true
  },
  settle(
    task: GenerationTask,
    status: Exclude<GenerationTaskStatus, 'streaming'>,
    error: string | null = null,
  ): boolean {
    const current = currentGenerationTask(task)
    if (!current || current.status !== 'streaming') return false
    if (current.fallbackTimer) clearTimeout(current.fallbackTimer)
    publishGenerationSnapshot({
      ...generationSnapshot,
      byKey: {
        ...generationSnapshot.byKey,
        [task.key]: {
          ...current,
          error,
          fallbackTimer: null,
          status,
        },
      },
    })
    if (status === 'cancelled') current.onCancelled?.()
    return true
  },
  start(input: StartGenerationTaskInput): GenerationTask | null {
    const existingForKey = generationSnapshot.byKey[input.key]
    if (existingForKey?.status === 'streaming') return null
    const targetNodeId = input.targetNodeId ?? null
    const existingTargetKey = targetNodeId
      ? generationSnapshot.byTarget[targetNodeId]
      : undefined
    const existingForTarget = existingTargetKey
      ? generationSnapshot.byKey[existingTargetKey]
      : undefined
    if (existingForTarget?.status === 'streaming') return null

    const byTarget = { ...generationSnapshot.byTarget }
    if (existingForKey?.targetNodeId && byTarget[existingForKey.targetNodeId] === input.key) {
      delete byTarget[existingForKey.targetNodeId]
    }
    if (targetNodeId) byTarget[targetNodeId] = input.key
    const task: GenerationTask = Object.freeze({
      controller: new AbortController(),
      error: null,
      fallbackTimer: null,
      key: input.key,
      kind: input.kind,
      onCancelled: input.onCancelled,
      ownerMainNodeId: input.ownerMainNodeId,
      phase: 'thinking',
      runId: nextGenerationRunId++,
      status: 'streaming',
      targetNodeId,
    })
    publishGenerationSnapshot({
      byKey: { ...generationSnapshot.byKey, [input.key]: task },
      byTarget,
    })
    return task
  },
  stop(key: string): boolean {
    const task = generationSnapshot.byKey[key]
    if (!task || task.status !== 'streaming' || task.controller.signal.aborted) return false
    const fallbackTimer = setTimeout(() => {
      generationTaskRegistry.settle(task, 'cancelled')
    }, 2000)
    publishGenerationSnapshot({
      ...generationSnapshot,
      byKey: {
        ...generationSnapshot.byKey,
        [key]: { ...task, fallbackTimer, phase: 'stopping' },
      },
    })
    task.controller.abort()
    return true
  },
  subscribe(listener: GenerationListener): () => void {
    generationListeners.add(listener)
    return () => generationListeners.delete(listener)
  },
}

export function useGenerationTasks<Selected>(
  selector: (snapshot: GenerationTaskRegistrySnapshot) => Selected,
): Selected {
  return useSyncExternalStore(
    generationTaskRegistry.subscribe,
    () => selector(generationTaskRegistry.getSnapshot()),
    () => selector(generationTaskRegistry.getSnapshot()),
  )
}

export const WORKBENCH_PANEL_ROLES = {
  main: 'main-document',
  subdoc: 'child-document',
  tree: 'tree-navigation',
} as const

export interface ToastNotice {
  message: string
  variant?: 'success' | 'error' | 'info'
  action?: { label: string; onClick(): void }
  live?: 'polite' | 'assertive'
}

export function computeChildTabs(
  nodesById: Record<string, NodeRow>,
  parentId: string,
): string[] {
  return Object.values(nodesById)
    .filter((node) => node.parent_id === parentId && node.is_deleted === 0)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )
    .map((node) => node.id)
}

export function computeNodePath(
  nodesById: Record<string, NodeRow>,
  nodeId: string | null,
): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  let current = nodeId
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = nodesById[current]
    if (!node) break
    path.unshift(node.id)
    current = node.parent_id
  }
  return path
}

interface WorkbenchData {
  activeSubdocId: string | null
  anchoredNoteId: string | null
  anchoredSubdocId: string | null
  backStack: string[]
  focusedAnnotationId: string | null
  focusMode: boolean
  forwardStack: string[]
  mainNodeId: string | null
  mainPath: string[]
  mergeRefreshTick: number
  mergeStateByNodeId: Record<string, 'merging' | 'merged'>
  nodesById: Record<string, NodeRow>
  notesForMain: AnnotationRow[]
  panelRoles: typeof WORKBENCH_PANEL_ROLES
  rootNodeId: string | null
  routeByNodeId: Record<string, RouteConvergence>
  subdocPanelTab: 'derivations' | 'notes'
  subdocTabs: string[]
  toast: string | ToastNotice | null
  trash: NodeRow[]
  treeId: string | null
  unreadNodeIds: string[]
  versionsByNodeId: Record<string, NodeVersionRow[]>
}

export interface WorkbenchState extends WorkbenchData {
  bumpMergeRefresh(): void
  clearToast(): void
  exitFocus(): void
  goBack(): void
  goForward(): void
  loadTree(input: {
    nodes: NodeRow[]
    rootNodeId: string
    treeId: string
  }): void
  markNodeRead(nodeId: string): void
  openSubdocTab(nodeId: string): void
  promoteSubdoc(nodeId: string): void
  reset(): void
  setActiveSubdoc(nodeId: string): void
  setAnchoredNoteId(id: string | null): void
  setAnchoredSubdocId(id: string | null): void
  setFocusedAnnotation(id: string | null): void
  setMain(nodeId: string): void
  setMergeState(nodeId: string, mergeState: 'merging' | 'merged' | null): void
  setNotesForMain(rows: AnnotationRow[]): void
  setRouteState(nodeId: string, route: RouteConvergence): void
  setSubdocPanelTab(tab: 'derivations' | 'notes'): void
  setSubtreeDeleted(nodeId: string, deleted: boolean): void
  setToast(message: string | ToastNotice): void
  setTrash(nodes: NodeRow[]): void
  setVersions(nodeId: string, versions: NodeVersionRow[]): void
  toggleFocus(): void
  upsertNode(node: NodeRow, options?: { refreshSubdocTabs?: boolean }): void
}

type Listener = () => void
const listeners = new Set<Listener>()

function initialData(): WorkbenchData {
  return {
    activeSubdocId: null,
    anchoredNoteId: null,
    anchoredSubdocId: null,
    backStack: [],
    focusedAnnotationId: null,
    focusMode: false,
    forwardStack: [],
    mainNodeId: null,
    mainPath: [],
    mergeRefreshTick: 0,
    mergeStateByNodeId: {},
    nodesById: {},
    notesForMain: [],
    panelRoles: WORKBENCH_PANEL_ROLES,
    rootNodeId: null,
    routeByNodeId: {},
    subdocPanelTab: 'derivations',
    subdocTabs: [],
    toast: null,
    trash: [],
    treeId: null,
    unreadNodeIds: [],
    versionsByNodeId: {},
  }
}

const unreadStorageKey = (treeId: string) => `vibe-docing:unread:${treeId}`

function loadUnread(treeId: string, nodesById: Record<string, NodeRow>): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(unreadStorageKey(treeId)) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && nodesById[id]?.is_deleted === 0)
      : []
  } catch {
    return []
  }
}

function persistUnread(treeId: string | null, ids: string[]): void {
  if (!treeId) return
  try {
    localStorage.setItem(unreadStorageKey(treeId), JSON.stringify(ids))
  } catch {}
}

function withoutNode(ids: string[], nodeId: string): string[] {
  return ids.filter((id) => id !== nodeId)
}

let state: WorkbenchState

function replace(next: WorkbenchState): void {
  state = next
  for (const listener of listeners) listener()
}

function patch(
  update:
    | Partial<WorkbenchData>
    | ((current: WorkbenchState) => Partial<WorkbenchData>),
): void {
  const partial = typeof update === 'function' ? update(state) : update
  replace({ ...state, ...partial })
}

function viewFor(
  current: WorkbenchState,
  nodeId: string,
): Pick<WorkbenchData, 'activeSubdocId' | 'mainNodeId' | 'mainPath' | 'subdocTabs'> {
  return {
    activeSubdocId: null,
    mainNodeId: nodeId,
    mainPath: computeNodePath(current.nodesById, nodeId),
    subdocTabs: computeChildTabs(current.nodesById, nodeId),
  }
}

const actions: Omit<WorkbenchState, keyof WorkbenchData> = {
  bumpMergeRefresh() {
    patch({ mergeRefreshTick: state.mergeRefreshTick + 1 })
  },
  clearToast() {
    patch({ toast: null })
  },
  exitFocus() {
    patch({ focusMode: false })
  },
  goBack() {
    if (state.backStack.length === 0 || !state.mainNodeId) return
    const destination = state.backStack[state.backStack.length - 1]
    const unreadNodeIds = withoutNode(state.unreadNodeIds, destination)
    persistUnread(state.treeId, unreadNodeIds)
    patch({
      ...viewFor(state, destination),
      backStack: state.backStack.slice(0, -1),
      forwardStack: [state.mainNodeId, ...state.forwardStack],
      unreadNodeIds,
    })
  },
  goForward() {
    if (state.forwardStack.length === 0 || !state.mainNodeId) return
    const [destination, ...remaining] = state.forwardStack
    const unreadNodeIds = withoutNode(state.unreadNodeIds, destination)
    persistUnread(state.treeId, unreadNodeIds)
    patch({
      ...viewFor(state, destination),
      backStack: [...state.backStack, state.mainNodeId],
      forwardStack: remaining,
      unreadNodeIds,
    })
  },
  loadTree(input) {
    resetGenerationTasks()
    const nodesById = Object.fromEntries(
      input.nodes.map((node) => [node.id, node]),
    )
    patch({
      ...initialData(),
      mainNodeId: input.rootNodeId,
      mainPath: computeNodePath(nodesById, input.rootNodeId),
      nodesById,
      rootNodeId: input.rootNodeId,
      subdocTabs: computeChildTabs(nodesById, input.rootNodeId),
      treeId: input.treeId,
      unreadNodeIds: withoutNode(loadUnread(input.treeId, nodesById), input.rootNodeId),
    })
  },
  markNodeRead(nodeId) {
    const unreadNodeIds = withoutNode(state.unreadNodeIds, nodeId)
    if (unreadNodeIds.length === state.unreadNodeIds.length) return
    persistUnread(state.treeId, unreadNodeIds)
    patch({ unreadNodeIds })
  },
  openSubdocTab(nodeId) {
    if (!state.nodesById[nodeId] || state.nodesById[nodeId].is_deleted === 1) return
    const unreadNodeIds = withoutNode(state.unreadNodeIds, nodeId)
    persistUnread(state.treeId, unreadNodeIds)
    patch({
      activeSubdocId: nodeId,
      subdocTabs: state.subdocTabs.includes(nodeId)
        ? state.subdocTabs
        : [...state.subdocTabs, nodeId],
      unreadNodeIds,
    })
  },
  promoteSubdoc(nodeId) {
    actions.setMain(nodeId)
  },
  reset() {
    resetGenerationTasks()
    replace({ ...initialData(), ...actions })
  },
  setActiveSubdoc(nodeId) {
    if (state.subdocTabs.includes(nodeId)) {
      const unreadNodeIds = withoutNode(state.unreadNodeIds, nodeId)
      persistUnread(state.treeId, unreadNodeIds)
      patch({ activeSubdocId: nodeId, unreadNodeIds })
    }
  },
  setAnchoredNoteId(id) {
    patch({ anchoredNoteId: id })
  },
  setAnchoredSubdocId(id) {
    patch({ anchoredSubdocId: id })
  },
  setFocusedAnnotation(id) {
    patch({ focusedAnnotationId: id })
  },
  setMain(nodeId) {
    const node = state.nodesById[nodeId]
    if (!node || node.is_deleted === 1 || nodeId === state.mainNodeId) return
    const unreadNodeIds = withoutNode(state.unreadNodeIds, nodeId)
    persistUnread(state.treeId, unreadNodeIds)
    patch({
      ...viewFor(state, nodeId),
      backStack: state.mainNodeId
        ? [...state.backStack, state.mainNodeId]
        : state.backStack,
      forwardStack: [],
      unreadNodeIds,
    })
  },
  setMergeState(nodeId, mergeState) {
    const next = { ...state.mergeStateByNodeId }
    if (mergeState === null) delete next[nodeId]
    else next[nodeId] = mergeState
    patch({ mergeStateByNodeId: next })
  },
  setNotesForMain(rows) {
    patch({ notesForMain: [...rows] })
  },
  setRouteState(nodeId, route) {
    patch({ routeByNodeId: { ...state.routeByNodeId, [nodeId]: route } })
  },
  setSubdocPanelTab(tab) {
    patch({ subdocPanelTab: tab })
  },
  setSubtreeDeleted(nodeId, deleted) {
    const flag: 0 | 1 = deleted ? 1 : 0
    const ids = new Set<string>()
    const stack = [nodeId]
    while (stack.length) {
      const current = stack.pop()!
      if (ids.has(current)) continue
      ids.add(current)
      for (const child of Object.values(state.nodesById)) {
        if (child.parent_id === current) stack.push(child.id)
      }
    }
    const nodesById = { ...state.nodesById }
    for (const id of ids) {
      if (nodesById[id]) nodesById[id] = { ...nodesById[id], is_deleted: flag }
    }
    const patchData: Partial<WorkbenchData> = { nodesById }
    if (deleted) {
      patchData.unreadNodeIds = state.unreadNodeIds.filter((id) => !ids.has(id))
      persistUnread(state.treeId, patchData.unreadNodeIds)
    }
    // If the current main document was deleted, fall back to its parent.
    if (deleted && state.mainNodeId && ids.has(state.mainNodeId)) {
      const parentId = state.nodesById[state.mainNodeId]?.parent_id
      if (parentId && nodesById[parentId]) {
        patchData.mainNodeId = parentId
        patchData.mainPath = computeNodePath(nodesById, parentId)
      }
    }
    if (state.mainNodeId && !ids.has(state.mainNodeId)) {
      patchData.subdocTabs = computeChildTabs(nodesById, state.mainNodeId)
    }
    patch(patchData)
  },
  setToast(message) {
    patch({ toast: message })
  },
  setTrash(nodes) {
    patch({ trash: [...nodes] })
  },
  setVersions(nodeId, versions) {
    patch({
      versionsByNodeId: { ...state.versionsByNodeId, [nodeId]: [...versions] },
    })
  },
  toggleFocus() {
    patch({ focusMode: !state.focusMode })
  },
  upsertNode(node, options) {
    const previous = state.nodesById[node.id]
    const nodesById = { ...state.nodesById, [node.id]: node }
    const mainNodeId = state.mainNodeId
    const becameTerminal = previous?.status === 'streaming' && node.status !== 'streaming'
    const isVisible = node.id === state.mainNodeId || node.id === state.activeSubdocId
    const unreadNodeIds = becameTerminal && !isVisible && !state.unreadNodeIds.includes(node.id)
      ? [...state.unreadNodeIds, node.id]
      : isVisible ? withoutNode(state.unreadNodeIds, node.id) : state.unreadNodeIds
    if (unreadNodeIds !== state.unreadNodeIds) persistUnread(state.treeId, unreadNodeIds)
    patch({
      mainPath:
        mainNodeId === node.id
          ? computeNodePath(nodesById, node.id)
          : state.mainPath,
      nodesById,
      unreadNodeIds,
      subdocTabs:
        mainNodeId && options?.refreshSubdocTabs !== false
          ? computeChildTabs(nodesById, mainNodeId)
          : state.subdocTabs,
    })
  },
}

state = { ...initialData(), ...actions }

interface WorkbenchHook {
  <Selected>(selector: (state: WorkbenchState) => Selected): Selected
  getState(): WorkbenchState
  subscribe(listener: Listener): () => void
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useWorkbench = Object.assign(
  function useWorkbenchSelector<Selected>(
    selector: (current: WorkbenchState) => Selected,
  ): Selected {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    )
  },
  {
    getState: () => state,
    subscribe,
  },
) as WorkbenchHook
