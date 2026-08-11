import type { VisualScene } from '@vibe/shared'

export interface SceneRect { x: number; y: number; width: number; height: number }
export interface SceneLayout {
  viewBox: { x: number; y: number; width: number; height: number }
  nodes: Array<{ id: string; label: string; rect: SceneRect; z: number }>
  edges: Array<{ id: string; label?: string; path: string; z: number }>
  groups: Array<{ id: string; label: string; rect: SceneRect; z: number }>
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 64
const GAP_X = 72
const GAP_Y = 52
const PADDING = 40

/** Pure, deterministic geometry shared by every rendering backend. */
export function sceneLayout(scene: VisualScene): SceneLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(scene.nodes.length || 1)))
  const nodes = scene.nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    rect: {
      x: PADDING + (index % columns) * (NODE_WIDTH + GAP_X),
      y: PADDING + Math.floor(index / columns) * (NODE_HEIGHT + GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    },
    z: 2,
  }))
  const byId = new Map(nodes.map((node) => [node.id, node.rect]))
  const edges = scene.edges.flatMap((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) return []
    const x1 = source.x + source.width / 2
    const y1 = source.y + source.height / 2
    const x2 = target.x + target.width / 2
    const y2 = target.y + target.height / 2
    return [{ id: edge.id, label: edge.label, path: `M ${x1} ${y1} L ${x2} ${y2}`, z: 1 }]
  })
  const groups = scene.groups.flatMap((group) => {
    const members = group.nodeIds.flatMap((id) => byId.get(id) ?? [])
    if (!members.length) return []
    const left = Math.min(...members.map((rect) => rect.x)) - 18
    const top = Math.min(...members.map((rect) => rect.y)) - 28
    const right = Math.max(...members.map((rect) => rect.x + rect.width)) + 18
    const bottom = Math.max(...members.map((rect) => rect.y + rect.height)) + 18
    return [{ id: group.id, label: group.label, rect: { x: left, y: top, width: right - left, height: bottom - top }, z: 0 }]
  })
  const rows = Math.max(1, Math.ceil((scene.nodes.length || 1) / columns))
  return {
    viewBox: {
      x: 0,
      y: 0,
      width: PADDING * 2 + columns * NODE_WIDTH + (columns - 1) * GAP_X,
      height: PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * GAP_Y,
    },
    nodes,
    edges,
    groups,
  }
}
