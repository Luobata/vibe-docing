import type { VisualArtifact } from '@vibe/shared'
import { useEffect, useRef } from 'react'
import { sceneLayout, type SceneLayout } from './scene-layout'

export interface SceneRendererProps { artifact: VisualArtifact; layout?: SceneLayout }

export function SvgSceneRenderer({ artifact, layout = sceneLayout(artifact) }: SceneRendererProps) {
  const box = layout.viewBox
  return <svg aria-hidden="true" data-edge-count={layout.edges.length} data-group-count={layout.groups.length}
    data-node-count={layout.nodes.length} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
    {layout.groups.map((group) => <g key={group.id}><rect className="visual-group" {...group.rect} /><text x={group.rect.x + 8} y={group.rect.y + 18}>{group.label}</text></g>)}
    {layout.edges.map((edge) => <g key={edge.id}><path className="visual-edge" d={edge.path} id={`edge-${edge.id}`} />{edge.label && <text><textPath href={`#edge-${edge.id}`} startOffset="50%">{edge.label}</textPath></text>}</g>)}
    {layout.nodes.map((node) => <g key={node.id}><rect className="visual-node" {...node.rect} /><text dominantBaseline="middle" textAnchor="middle" x={node.rect.x + node.rect.width / 2} y={node.rect.y + node.rect.height / 2}>{node.label}</text></g>)}
  </svg>
}

export function CanvasSceneRenderer({ artifact, layout = sceneLayout(artifact) }: SceneRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(layout.viewBox.width * ratio)
    canvas.height = Math.round(layout.viewBox.height * ratio)
    canvas.style.aspectRatio = `${layout.viewBox.width} / ${layout.viewBox.height}`
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, layout.viewBox.width, layout.viewBox.height)
    context.font = '14px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.strokeStyle = '#cbd5e1'
    for (const group of layout.groups) {
      context.strokeRect(group.rect.x, group.rect.y, group.rect.width, group.rect.height)
      context.fillText(group.label, group.rect.x + group.rect.width / 2, group.rect.y + 14)
    }
    context.strokeStyle = '#94a3b8'
    for (const edge of layout.edges) {
      const match = edge.path.match(/M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/)
      if (!match) continue
      context.beginPath()
      context.moveTo(+match[1], +match[2])
      context.lineTo(+match[3], +match[4])
      context.stroke()
      if (edge.label) context.fillText(edge.label, (+match[1] + +match[3]) / 2, (+match[2] + +match[4]) / 2)
    }
    for (const node of layout.nodes) {
      context.strokeRect(node.rect.x, node.rect.y, node.rect.width, node.rect.height)
      context.fillText(node.label, node.rect.x + node.rect.width / 2, node.rect.y + node.rect.height / 2)
    }
  }, [layout])
  return <canvas aria-hidden="true" data-edge-count={layout.edges.length} data-group-count={layout.groups.length} data-node-count={layout.nodes.length} ref={canvasRef} />
}
