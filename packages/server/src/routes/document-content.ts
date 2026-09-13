import type { DocumentAnchorPatch, ProseMirrorNode } from '@vibe/shared'
import { documentContentOf, parseJsonCanvas, prosemirrorToPlainText } from '@vibe/shared'
import type { DecoratedApp } from '../app'
import type { AppDeps } from '../deps'

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_DOCUMENT_DEPTH = 24
const MAX_DOCUMENT_NODES = 50_000

const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'text', 'hard_break', 'horizontal_rule',
  'blockquote', 'bullet_list', 'ordered_list', 'list_item', 'task_list',
  'task_item', 'code_block', 'table', 'table_row', 'table_header',
  'table_cell', 'visual_ref',
  'hardBreak', 'horizontalRule', 'bulletList', 'orderedList', 'listItem',
  'taskList', 'taskItem', 'codeBlock', 'tableRow', 'tableHeader', 'tableCell',
])
const ALLOWED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link'])

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safeLink(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 4_096) return false
  return /^(https?:|mailto:|\/|#)/i.test(value)
}

function validDocument(value: unknown): value is ProseMirrorNode {
  const root = record(value)
  if (!root || root.type !== 'doc') return false
  let count = 0

  function visit(candidate: unknown, depth: number): boolean {
    if (depth > MAX_DOCUMENT_DEPTH || ++count > MAX_DOCUMENT_NODES) return false
    const node = record(candidate)
    if (!node || typeof node.type !== 'string' || !ALLOWED_NODES.has(node.type)) return false
    if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string')) return false
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || !node.content.every((child) => visit(child, depth + 1))) return false
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) return false
      for (const candidateMark of node.marks) {
        const mark = record(candidateMark)
        if (!mark || typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type)) return false
        if (mark.type === 'link' && !safeLink(record(mark.attrs)?.href)) return false
      }
    }
    if (node.type === 'visual_ref') {
      const attrs = record(node.attrs)
      if (!attrs || typeof attrs.artifactId !== 'string' || !attrs.artifactId.trim()
        || !Number.isInteger(attrs.revision) || (attrs.revision as number) < 1
        || typeof attrs.altText !== 'string' || !attrs.altText.trim()) return false
    }
    return true
  }

  return visit(value, 0)
}

function validAnchor(value: unknown, text: string): value is DocumentAnchorPatch {
  const anchor = record(value)
  if (!anchor || typeof anchor.id !== 'string' || !anchor.id) return false
  if (anchor.status !== 'valid' && anchor.status !== 'orphaned') return false
  if (anchor.quotedText !== null && typeof anchor.quotedText !== 'string') return false
  if (anchor.status === 'orphaned') return anchor.from === null && anchor.to === null
  if (!Number.isInteger(anchor.from) || !Number.isInteger(anchor.to)) return false
  const from = anchor.from as number
  const to = anchor.to as number
  return from >= 0 && to >= from && to <= text.length
    && text.slice(from, to) === (anchor.quotedText ?? '')
}

export function saveDocumentContent(
  deps: Pick<AppDeps, 'nodes' | 'vault' | 'db' | 'annotations' | 'versions'>,
  nodeId: string,
  input: unknown,
) {
  const body = record(input)
  const doc = body?.doc
  const nativeSource = body?.source
  const fileKind = body?.fileKind
  const nativeDocument = typeof nativeSource === 'string' && body?.schemaVersion === 2
    && (fileKind === 'markdown' || fileKind === 'canvas' || fileKind === 'base')
  const serialized = nativeDocument ? nativeSource : (doc === undefined ? '' : JSON.stringify(doc))
  const validSource = nativeDocument
    && (fileKind !== 'canvas' || parseJsonCanvas(serialized) !== undefined)
  if (
    !body ||
    !Number.isInteger(body.baseRevision) ||
    (body.baseRevision as number) < 0 ||
    (body.schemaVersion !== 1 && body.schemaVersion !== 2) ||
    typeof body.editSessionId !== 'string' ||
    !body.editSessionId.trim() ||
    body.editSessionId.length > 200 ||
    Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_BYTES ||
    (!validSource && !validDocument(doc))
  ) {
    return { statusCode: 400 as const, body: { error: 'invalid document content body' } }
  }

  const anchorText = nativeDocument ? serialized : prosemirrorToPlainText(serialized)
  const anchors = body.anchors ?? []
  if (!Array.isArray(anchors) || anchors.length > 1_000
    || !anchors.every((anchor) => validAnchor(anchor, anchorText))) {
    return { statusCode: 400 as const, body: { error: 'invalid document anchors' } }
  }

  const found = deps.nodes.get(nodeId)
  const existing = found?.file_path ? deps.vault.hydrateNode(found) : found
  if (!existing || existing.is_deleted === 1) {
    return { statusCode: 404 as const, body: { error: 'node not found' } }
  }
  const editSessionId = body.editSessionId as string

  const save = deps.db.transaction(() => {
    const node = deps.nodes.updateDocumentContent({
      baseRevision: body.baseRevision as number,
      content: serialized,
      id: existing.id,
      schemaVersion: nativeDocument ? 2 : 1,
    })
    if (!node) return undefined
    const persisted = nativeDocument
      ? deps.vault.writeNode(node, serialized, fileKind as 'markdown' | 'canvas' | 'base')
      : node
    deps.annotations.updateAnchors(existing.id, anchors as DocumentAnchorPatch[])
    deps.versions.snapshotEditSession({
      aiResponse: persisted.ai_response,
      documentContent: documentContentOf(persisted),
      changeKind: 'edit',
      contentRevision: persisted.content_revision ?? 0,
      editSessionId: editSessionId.trim(),
      nodeId: persisted.id,
      userInput: persisted.user_input,
    })
    return persisted
  })
  const node = save()
  if (!node) {
    const current = deps.nodes.get(existing.id)!
    return { statusCode: 409 as const, body: {
      currentRevision: current.content_revision ?? 0,
      error: 'content conflict',
      node: current,
    } }
  }

  return { statusCode: 200 as const, body: {
    content: {
      ...(nativeDocument
        ? {
          contentHash: node.content_hash ?? null,
          fileKind,
          filePath: node.file_path ?? null,
          source: serialized,
        }
        : { doc }),
      nodeId: node.id,
      revision: node.content_revision ?? 0,
      schemaVersion: nativeDocument ? 2 : 1,
      updatedAt: node.content_updated_at ?? null,
    },
    node,
  } }
}

export function registerDocumentContentRoutes(app: DecoratedApp): void {
  app.patch('/api/nodes/:id/content', async (request, reply) => {
    const result = saveDocumentContent(app.deps, request.params.id, request.body)
    return reply.code(result.statusCode).send(result.body)
  })
}
