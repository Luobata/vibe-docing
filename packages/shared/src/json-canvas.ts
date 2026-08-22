export type JsonCanvasNode = {
  id: string
  type: 'text' | 'file' | 'link' | 'group'
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  background?: string
  backgroundStyle?: 'cover' | 'ratio' | 'repeat'
  [key: string]: unknown
}

export type JsonCanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  fromSide?: 'top' | 'right' | 'bottom' | 'left'
  toSide?: 'top' | 'right' | 'bottom' | 'left'
  fromEnd?: 'none' | 'arrow'
  toEnd?: 'none' | 'arrow'
  color?: string
  label?: string
  [key: string]: unknown
}

export interface JsonCanvasFile {
  nodes: JsonCanvasNode[]
  edges: JsonCanvasEdge[]
  [key: string]: unknown
}

export function parseJsonCanvas(source: string): JsonCanvasFile | undefined {
  try {
    const value = JSON.parse(source) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const nodes = value.nodes ?? []
    const edges = value.edges ?? []
    if (!Array.isArray(nodes) || !Array.isArray(edges)) return undefined
    const validNodes = nodes.every((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
      const node = candidate as Record<string, unknown>
      return typeof node.id === 'string'
        && ['text', 'file', 'link', 'group'].includes(String(node.type))
        && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(node[key]))
    })
    const nodeIds = new Set(nodes.map((node) => (node as Record<string, unknown>).id))
    const validEdges = edges.every((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
      const edge = candidate as Record<string, unknown>
      return typeof edge.id === 'string'
        && typeof edge.fromNode === 'string'
        && typeof edge.toNode === 'string'
        && nodeIds.has(edge.fromNode)
        && nodeIds.has(edge.toNode)
    })
    return validNodes && validEdges ? value as JsonCanvasFile : undefined
  } catch {
    return undefined
  }
}
