import type { RouteTarget } from '@vibe/shared'
import type { ContextEngine } from '../context/context-engine'
import { prosemirrorToPlainText } from '../context/prosemirror'
import type { Provider } from '../provider/types'
import type { createAnnotationRepo } from '../repo/annotation-repo'
import type { createNodeRepo } from '../repo/node-repo'
import type { createSettingsRepo } from '../repo/settings-repo'
import { convergeRouteCandidates } from './route-convergence'
import {
  DEFAULT_ROUTE_THRESHOLDS,
  type RouteCandidate,
  type RouteConvergence,
  type RouteThresholds,
} from './route-types'

type AnnotationRepo = ReturnType<typeof createAnnotationRepo>
type NodeRepo = ReturnType<typeof createNodeRepo>
type SettingsRepo = ReturnType<typeof createSettingsRepo>

const routeTargets = new Set<RouteTarget>([
  'main-continuation',
  'bound-subdoc',
  'new-branch',
])

interface RouteOutline {
  mainDocument: { id: string; summary: string }
  segments: Array<{ id: string; text: string }>
  subdocuments: Array<{ id: string; title: string }>
}

function readThreshold(
  settings: SettingsRepo,
  key: string,
  fallback: number,
): number {
  const configured = settings.get(key)
  if (configured === undefined) return fallback
  const value = Number(configured)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function thresholdsFrom(settings: SettingsRepo): RouteThresholds {
  return {
    highConfidence: readThreshold(
      settings,
      'routing.highConfidence',
      DEFAULT_ROUTE_THRESHOLDS.highConfidence,
    ),
    leadMargin: readThreshold(
      settings,
      'routing.leadMargin',
      DEFAULT_ROUTE_THRESHOLDS.leadMargin,
    ),
  }
}

function firstLine(value: string | null): string {
  return value?.split('\n')[0]?.trim() || '未命名'
}

function buildOutline(
  deps: { annotations: AnnotationRepo; nodes: NodeRepo },
  mainNodeId: string,
  excludedNodeId: string,
): RouteOutline {
  const mainNode = deps.nodes.get(mainNodeId)
  const annotations = deps.annotations.listByNode(mainNodeId)
  const linkedIds = new Set<string>()
  const subdocuments = annotations.flatMap((annotation) => {
    if (!annotation.child_node_id) return []
    const child = deps.nodes.get(annotation.child_node_id)
    if (!child || child.is_deleted === 1) return []
    linkedIds.add(child.id)
    return [{ id: child.id, title: firstLine(child.user_input) }]
  })

  for (const child of deps.nodes.getChildren(mainNodeId)) {
    if (child.id !== excludedNodeId && !linkedIds.has(child.id)) {
      subdocuments.push({ id: child.id, title: firstLine(child.user_input) })
    }
  }

  return {
    mainDocument: {
      id: mainNodeId,
      summary: prosemirrorToPlainText(mainNode?.ai_response ?? null).slice(0, 2_000),
    },
    segments: annotations.flatMap((annotation) =>
      annotation.quoted_text
        ? [{ id: annotation.id, text: annotation.quoted_text }]
        : [],
    ),
    subdocuments,
  }
}

function unwrapJson(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced?.[1] ?? trimmed
}

function parseCandidates(raw: string): RouteCandidate[] {
  const parsed = JSON.parse(unwrapJson(raw)) as { candidates?: unknown }
  if (!Array.isArray(parsed.candidates)) return []

  return parsed.candidates.flatMap((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const candidate = value as Record<string, unknown>
    if (
      typeof candidate.target !== 'string' ||
      !routeTargets.has(candidate.target as RouteTarget) ||
      typeof candidate.score !== 'number' ||
      !Number.isFinite(candidate.score) ||
      candidate.score < 0 ||
      candidate.score > 1 ||
      (candidate.refId !== null && typeof candidate.refId !== 'string')
    ) {
      return []
    }
    return [
      {
        label:
          typeof candidate.label === 'string' && candidate.label.trim()
            ? candidate.label.trim()
            : candidate.target,
        refId: candidate.refId,
        score: candidate.score,
        target: candidate.target as RouteTarget,
      },
    ]
  })
}

export function createRouteDecisionService(deps: {
  annotations: AnnotationRepo
  context: Pick<ContextEngine, 'assemble'>
  nodes: NodeRepo
  provider: Provider
  settings: SettingsRepo
}) {
  async function route(input: { answerNodeId: string }): Promise<RouteConvergence> {
    const thresholds = thresholdsFrom(deps.settings)
    const answerNode = deps.nodes.get(input.answerNodeId)
    if (!answerNode || answerNode.is_deleted === 1 || !answerNode.parent_id) {
      return {
        ...convergeRouteCandidates([], thresholds),
        reason: 'active optimistic answer and parent are required',
      }
    }

    const mainNode = deps.nodes.get(answerNode.parent_id)
    const question = answerNode.user_input?.trim()
    if (!mainNode || mainNode.is_deleted === 1 || !question) {
      return {
        ...convergeRouteCandidates([], thresholds),
        reason: 'active main document and question are required',
      }
    }

    const outline = buildOutline(deps, mainNode.id, answerNode.id)
    const contextMessages = deps.context.assemble(mainNode.id, question)
    try {
      const rawDecision = await deps.provider.complete([
        {
          content:
            '判断最后一个问题应挂到哪里。只返回 JSON：{"candidates":[{"target":"main-continuation|bound-subdoc|new-branch","refId":null,"label":"...","score":0.0}]}。返回 2-3 个候选。',
          role: 'system',
        },
        ...contextMessages,
        {
          content: `可用落点大纲：${JSON.stringify(outline)}`,
          role: 'user',
        },
      ])
      return convergeRouteCandidates(parseCandidates(rawDecision), thresholds)
    } catch (error) {
      return {
        ...convergeRouteCandidates([], thresholds),
        reason: error instanceof Error ? error.message : 'route classification failed',
      }
    }
  }

  return { route }
}
