import {
  documentContentOf,
  legacyDocumentToMarkdown,
  type CorrectDraft,
  type CorrectionMode,
  type MergeRow,
  type NodeRow,
} from '@vibe/shared'
import type { AppDeps } from '../deps'
import type { Provider } from '../provider/types'

export class CorrectionNotFoundError extends Error {}
export class InvalidCorrectionError extends Error {}

function jsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  const candidate = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed
  try {
    const value = JSON.parse(candidate) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function parseDraft(raw: string, mode: CorrectionMode): CorrectDraft {
  const object = jsonObject(raw)
  if (!object) throw new InvalidCorrectionError('provider returned an invalid correction draft')
  if (mode === 'append') {
    const section = object.section
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      throw new InvalidCorrectionError('provider returned an invalid append draft')
    }
    const value = section as Record<string, unknown>
    const title = typeof value.title === 'string' ? value.title : ''
    const body = typeof value.body === 'string' ? value.body : ''
    if (!title.trim() || !body.trim()) {
      throw new InvalidCorrectionError('provider returned an invalid append draft')
    }
    return { mode, section: { body, title } }
  }
  if (mode === 'rewrite') {
    if (typeof object.fullText !== 'string') {
      throw new InvalidCorrectionError('provider returned an invalid rewrite draft')
    }
    return { fullText: object.fullText, mode }
  }

  if (!Array.isArray(object.pairs) || object.pairs.length === 0) {
    throw new InvalidCorrectionError('provider returned an invalid patch draft')
  }
  const pairs = object.pairs.map((candidate) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
    const pair = candidate as Record<string, unknown>
    return typeof pair.quote === 'string' && pair.quote.length > 0 && typeof pair.replacement === 'string'
      ? { quote: pair.quote, replacement: pair.replacement }
      : undefined
  })
  if (pairs.some((pair) => pair === undefined)) {
    throw new InvalidCorrectionError('provider returned an invalid patch draft')
  }
  return {
    mode,
    pairs: pairs as Array<{ quote: string; replacement: string }>,
    unmatched: { heading: '纠正附注', strategy: 'append-note' },
  }
}

export function createCorrectService(
  deps: Pick<AppDeps, 'context' | 'db' | 'merges' | 'nodes' | 'versions' | 'vault'>,
) {
  function sourceAndTarget(sourceNodeId: string): { source: NodeRow; target: NodeRow } {
    const source = deps.nodes.get(sourceNodeId)
    if (!source || source.is_deleted === 1) {
      throw new CorrectionNotFoundError(`active source node not found: ${sourceNodeId}`)
    }
    if (!source.parent_id) {
      throw new InvalidCorrectionError('correction target must be the direct parent')
    }
    const target = deps.nodes.get(source.parent_id)
    if (!target || target.is_deleted === 1) {
      throw new CorrectionNotFoundError(`active target node not found: ${source.parent_id}`)
    }
    if (source.parent_id !== target.id) {
      throw new InvalidCorrectionError('correction target must be the direct parent')
    }
    return { source, target }
  }

  async function draft(input: {
    direction: string
    includeSubtree: boolean
    mode: CorrectionMode
    provider: Provider
    sourceNodeId: string
  }): Promise<CorrectDraft> {
    const direction = input.direction.trim()
    if (!direction) throw new InvalidCorrectionError('correction direction is required')
    const { source, target } = sourceAndTarget(input.sourceNodeId)
    const messages = deps.context.assembleForCorrection({
      direction,
      includeSubtree: input.includeSubtree,
      mode: input.mode,
      sourceNodeId: source.id,
      targetNodeId: target.id,
    })
    return parseDraft(await input.provider.complete(messages), input.mode)
  }

  function commit(input: {
    direction: string
    documentContent: string
    sourceNodeId: string
  }): { merge: MergeRow; node: NodeRow } {
    const direction = input.direction.trim()
    if (!direction) throw new InvalidCorrectionError('correction direction is required')

    return deps.db.transaction(() => {
      const { source, target } = sourceAndTarget(input.sourceNodeId)
      const before = legacyDocumentToMarkdown(
        documentContentOf(target),
        target.content_schema_version ?? 0,
      )
      deps.versions.snapshot({
        aiResponse: target.ai_response,
        changeKind: 'correction',
        documentContent: before,
        nodeId: target.id,
        userInput: target.user_input,
      })
      let node = deps.nodes.updateContent(target.id, {
        contentSchemaVersion: 2,
        documentContent: input.documentContent,
      })
      if (node.file_path && node.vault_root) {
        node = deps.vault.writeNode(
          node,
          input.documentContent,
          node.file_kind === 'canvas' || node.file_kind === 'base' ? node.file_kind : 'markdown',
        )
      }
      deps.versions.snapshot({
        aiResponse: node.ai_response,
        changeKind: 'correction',
        contentRevision: node.content_revision ?? null,
        documentContent: input.documentContent,
        nodeId: node.id,
        userInput: node.user_input,
      })
      const merge = deps.merges.record({
        conclusion: '',
        direction,
        kind: 'correction',
        landingSegmentId: null,
        sourceNodeId: source.id,
        targetNodeId: target.id,
      })
      return { merge, node }
    })()
  }

  return { commit, draft }
}
