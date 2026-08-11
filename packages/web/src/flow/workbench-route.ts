import type { Api } from '../api/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkbench } from '../state/workbench-store'

export interface WorkbenchRoute {
  nodeId: string | null
  panel: 'derivations' | 'notes'
  subdocId: string | null
  treeId: string | null
  view: 'document' | 'trash'
}

const decode = (value: string | undefined): string | null => {
  if (!value) return null
  try { return decodeURIComponent(value) } catch { return null }
}

export function parseWorkbenchRoute(locationLike: Pick<Location, 'pathname' | 'search'>): WorkbenchRoute {
  const trash = locationLike.pathname.match(/^\/trash(?:\/([^/]+))?\/?$/)
  if (trash) {
    return { nodeId: null, panel: 'derivations', subdocId: null, treeId: decode(trash[1]), view: 'trash' }
  }
  const document = locationLike.pathname.match(/^\/trees\/([^/]+)\/documents\/([^/]+)\/?$/)
  const params = new URLSearchParams(locationLike.search)
  return {
    nodeId: decode(document?.[2]),
    panel: params.get('panel') === 'notes' ? 'notes' : 'derivations',
    subdocId: params.get('subdoc'),
    treeId: decode(document?.[1]),
    view: 'document',
  }
}

export function serializeWorkbenchRoute(route: WorkbenchRoute): string {
  if (route.view === 'trash') return route.treeId ? `/trash/${encodeURIComponent(route.treeId)}` : '/trash'
  if (!route.treeId || !route.nodeId) return '/'
  const query = new URLSearchParams()
  if (route.subdocId) query.set('subdoc', route.subdocId)
  if (route.panel !== 'derivations') query.set('panel', route.panel)
  const search = query.toString()
  return `/trees/${encodeURIComponent(route.treeId)}/documents/${encodeURIComponent(route.nodeId)}${search ? `?${search}` : ''}`
}

export function useWorkbenchRoute(api: Api) {
  const treeId = useWorkbench((state) => state.treeId)
  const mainNodeId = useWorkbench((state) => state.mainNodeId)
  const activeSubdocId = useWorkbench((state) => state.activeSubdocId)
  const panel = useWorkbench((state) => state.subdocPanelTab)
  const initial = parseWorkbenchRoute(window.location)
  const [view, setView] = useState<WorkbenchRoute['view']>(initial.view)
  const [trashTreeId, setTrashTreeId] = useState<string | null>(initial.treeId)
  const applying = useRef(true)

  const applyRoute = useCallback(async (route: WorkbenchRoute) => {
    applying.current = true
    setView(route.view)
    setTrashTreeId(route.view === 'trash' ? route.treeId : null)
    if (route.view === 'document' && route.treeId) {
      let current = useWorkbench.getState()
      if (current.treeId !== route.treeId) {
        const getTree = (api as Partial<Api>).getTree
        if (getTree) {
          try {
            const result = await getTree(route.treeId)
            const rootNodeId = result.tree.root_node_id
            if (rootNodeId) useWorkbench.getState().loadTree({ nodes: result.nodes, rootNodeId, treeId: result.tree.id })
          } catch {
            useWorkbench.getState().setToast('链接中的文档树加载失败。')
          }
        }
      }
      current = useWorkbench.getState()
      if (route.nodeId && current.nodesById[route.nodeId]) current.setMain(route.nodeId)
      if (route.subdocId && current.nodesById[route.subdocId]) {
        current.openSubdocTab(route.subdocId)
        current.setActiveSubdoc(route.subdocId)
      }
      current.setSubdocPanelTab(route.panel)
    }
    queueMicrotask(() => { applying.current = false })
  }, [api])

  useEffect(() => {
    void applyRoute(parseWorkbenchRoute(window.location))
    const onPopState = () => { void applyRoute(parseWorkbenchRoute(window.location)) }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyRoute])

  useEffect(() => {
    if (applying.current || view !== 'document') return
    const next = serializeWorkbenchRoute({ nodeId: mainNodeId, panel, subdocId: activeSubdocId, treeId, view: 'document' })
    const current = window.location.pathname + window.location.search
    if (next !== current) window.history.pushState({}, '', next)
  }, [activeSubdocId, mainNodeId, panel, treeId, view])

  return {
    openDocument() {
      const next = serializeWorkbenchRoute({ nodeId: mainNodeId, panel, subdocId: activeSubdocId, treeId, view: 'document' })
      window.history.pushState({}, '', next)
      setView('document')
      setTrashTreeId(null)
    },
    openTrash() {
      const next = serializeWorkbenchRoute({ nodeId: null, panel, subdocId: null, treeId, view: 'trash' })
      window.history.pushState({}, '', next)
      setTrashTreeId(treeId)
      setView('trash')
    },
    trashTreeId,
    view,
  }
}
