import type { ComponentType } from 'react'
import type { SceneRendererProps } from './renderers'
import { CanvasSceneRenderer, SvgSceneRenderer } from './renderers'

const renderers: Readonly<Record<string, ComponentType<SceneRendererProps>>> = Object.freeze({
  canvas: CanvasSceneRenderer,
  svg: SvgSceneRenderer,
})

/** Exact allow-list lookup: unknown values are never imported or guessed. */
export function getVisualRenderer(renderer: string): ComponentType<SceneRendererProps> | undefined {
  return Object.prototype.hasOwnProperty.call(renderers, renderer) ? renderers[renderer] : undefined
}
