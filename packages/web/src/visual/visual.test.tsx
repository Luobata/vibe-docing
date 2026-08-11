import type { VisualArtifact, VisualStreamEvent } from '@vibe/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VisualBlockView } from '../components/VisualBlockView'
import { getVisualRenderer } from './renderer-registry'
import { CanvasSceneRenderer, SvgSceneRenderer } from './renderers'
import { sceneLayout } from './scene-layout'
import { reduceVisualStream } from './visual-stream-state'

const artifact: VisualArtifact = {
  artifactId: 'a', revision: 2, schemaVersion: 1, kind: 'flow', renderer: 'svg',
  title: '流程', altText: 'A 到 B', groups: [{ id: 'g', label: '组', nodeIds: ['a', 'b'] }],
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'e', source: 'a', target: 'b' }],
}

describe('visual frontend contract', () => {
  it('uses an exact renderer allow-list', () => {
    expect(getVisualRenderer('svg')).toBe(SvgSceneRenderer)
    expect(getVisualRenderer('canvas')).toBe(CanvasSceneRenderer)
    expect(getVisualRenderer('SVG')).toBeUndefined()
    expect(getVisualRenderer('../dynamic')).toBeUndefined()
  })

  it('gives SVG and Canvas the same deterministic geometry', () => {
    const first = sceneLayout(artifact)
    expect(sceneLayout({ ...artifact, renderer: 'canvas' })).toEqual(first)
    expect(first.nodes[0].rect).toMatchObject({ x: 40, y: 40 })
    expect(first).toMatchObject({ edges: [{ id: 'e' }], groups: [{ id: 'g' }] })
  })

  it('updates a placeholder in place and rejects stale events', () => {
    const placeholder: VisualStreamEvent = { type: 'visual_placeholder', placeholderId: 'p', artifactId: 'a', revision: 2 }
    const ready: VisualStreamEvent = { type: 'visual_ready', placeholderId: 'p', artifactId: 'a', revision: 2, artifact }
    const stale: VisualStreamEvent = { type: 'visual_error', placeholderId: 'p', artifactId: 'a', revision: 1, reason: 'late', fallback: 'text' }
    const complete = reduceVisualStream(reduceVisualStream({}, placeholder), ready)
    expect(complete.p.status).toBe('ready')
    expect(reduceVisualStream(complete, stale)).toBe(complete)
  })

  it('supports zoom controls and whole-visual annotation', () => {
    const onAnnotate = vi.fn()
    render(<VisualBlockView artifact={artifact} onAnnotate={onAnnotate} reference={{ artifactId: 'a', revision: 2, altText: '安全替代文本' }} />)
    expect(screen.getByRole('img', { name: 'A 到 B' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(screen.getByText('110%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批注整图' }))
    expect(onAnnotate).toHaveBeenCalledOnce()
  })

  it('falls back to alt text for an unknown renderer', () => {
    render(<VisualBlockView artifact={{ ...artifact, renderer: 'custom' as 'svg' }} reference={{ artifactId: 'a', revision: 2, altText: '安全替代文本' }} />)
    expect(screen.getByText('安全替代文本')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
