import type { AnnotationRow, NodeRow, NodeVersionRow } from '@vibe/shared'
import { useSyncExternalStore } from 'react'
import type { RouteConvergence } from '../api/types'

export const WORKBENCH_PANEL_ROLES = {
  main: 'main-document',
  subdoc: 'child-document',
  tree: 'tree-navigation',
} as const

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
  backStack: string[]
  focusedAnnotationId: string | null
  focusMode: boolean
  forwardStack: string[]
  mainNodeId: string | null
  mainPath: string[]
  mergeStateByNodeId: Record<string, 'merging' | 'merged'>
  nodesById: Record<string, NodeRow>
  notesForMain: AnnotationRow[]
  panelRoles: typeof WORKBENCH_PANEL_ROLES
  rootNodeId: string | null
  routeByNodeId: Record<string, RouteConvergence>
  subdocTabs: string[]
  toast: string | null
  trash: NodeRow[]
  treeId: string | null
  versionsByNodeId: Record<string, NodeVersionRow[]>
}

export interface WorkbenchState extends WorkbenchData {
  clearToast(): void
  exitFocus(): void
  goBack(): void
  goForward(): void
  loadTree(input: {
    nodes: NodeRow[]
    rootNodeId: string
    treeId: string
  }): void
  openSubdocTab(nodeId: string): void
  promoteSubdoc(nodeId: string): void
  reset(): void
  setActiveSubdoc(nodeId: string): void
  setFocusedAnnotation(id: string | null): void
  setMain(nodeId: string): void
  setMergeState(nodeId: string, mergeState: 'merging' | 'merged' | null): void
  setNotesForMain(rows: AnnotationRow[]): void
  setRouteState(nodeId: string, route: RouteConvergence): void
  setSubtreeDeleted(nodeId: string, deleted: boolean): void
  setToast(message: string): void
  setTrash(nodes: NodeRow[]): void
  setVersions(nodeId: string, versions: NodeVersionRow[]): void
  toggleFocus(): void
  upsertNode(node: NodeRow): void
}

type Listener = () => void
const listeners = new Set<Listener>()

function initialData(): WorkbenchData {
  return {
    activeSubdocId: null,
    backStack: [],
    focusedAnnotationId: null,
    focusMode: false,
    forwardStack: [],
    mainNodeId: null,
    mainPath: [],
    mergeStateByNodeId: {},
    nodesById: {},
    notesForMain: [],
    panelRoles: WORKBENCH_PANEL_ROLES,
    rootNodeId: null,
    routeByNodeId: {},
    subdocTabs: [],
    toast: null,
    trash: [],
    treeId: null,
    versionsByNodeId: {},
  }
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
  clearToast() {
    patch({ toast: null })
  },
  exitFocus() {
    patch({ focusMode: false })
  },
  goBack() {
    if (state.backStack.length === 0 || !state.mainNodeId) return
    const destination = state.backStack[state.backStack.length - 1]
    patch({
      ...viewFor(state, destination),
      backStack: state.backStack.slice(0, -1),
      forwardStack: [state.mainNodeId, ...state.forwardStack],
    })
  },
  goForward() {
    if (state.forwardStack.length === 0 || !state.mainNodeId) return
    const [destination, ...remaining] = state.forwardStack
    patch({
      ...viewFor(state, destination),
      backStack: [...state.backStack, state.mainNodeId],
      forwardStack: remaining,
    })
  },
  loadTree(input) {
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
    })
  },
  openSubdocTab(nodeId) {
    if (!state.nodesById[nodeId] || state.nodesById[nodeId].is_deleted === 1) return
    patch({
      activeSubdocId: nodeId,
      subdocTabs: state.subdocTabs.includes(nodeId)
        ? state.subdocTabs
        : [...state.subdocTabs, nodeId],
    })
  },
  promoteSubdoc(nodeId) {
    actions.setMain(nodeId)
  },
  reset() {
    replace({ ...initialData(), ...actions })
  },
  setActiveSubdoc(nodeId) {
    if (state.subdocTabs.includes(nodeId)) patch({ activeSubdocId: nodeId })
  },
  setFocusedAnnotation(id) {
    patch({ focusedAnnotationId: id })
  },
  setMain(nodeId) {
    const node = state.nodesById[nodeId]
    if (!node || node.is_deleted === 1 || nodeId === state.mainNodeId) return
    patch({
      ...viewFor(state, nodeId),
      backStack: state.mainNodeId
        ? [...state.backStack, state.mainNodeId]
        : state.backStack,
      forwardStack: [],
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
  upsertNode(node) {
    const nodesById = { ...state.nodesById, [node.id]: node }
    const mainNodeId = state.mainNodeId
    patch({
      mainPath:
        mainNodeId === node.id
          ? computeNodePath(nodesById, node.id)
          : state.mainPath,
      nodesById,
      subdocTabs:
        mainNodeId
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
