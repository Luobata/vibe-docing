import {
  legacyDocumentToMarkdown,
  type ContextSegmentRow,
  type CorrectionMode,
  type NodeRow,
} from '@vibe/shared'
import type { ChatMessage } from './assemble'
import { resolveSegmentContent, type ResolveSegmentDeps } from './resolve-segment'

export const CORRECTION_EVIDENCE_CHAR_LIMIT = 12_000
const TRUNCATION_MARKER = '\n\n[分支证据因达到体量上限已截断]'

export interface AssembleCorrectionDeps extends ResolveSegmentDeps {
  nodes: ResolveSegmentDeps['nodes'] & {
    getChildren(parentId: string): NodeRow[]
  }
}

interface AssembleCorrectionInput {
  direction: string
  includeSubtree: boolean
  mode: CorrectionMode
  sourceNodeId: string
  targetNodeId: string
}

function resolvedNodeContent(
  deps: AssembleCorrectionDeps,
  node: NodeRow,
): { document: string; prompt: string } {
  // Treat a node reference exactly like an unlocked ancestor-full segment so
  // correction context shares the existing legacy/deletion resolution path.
  const synthetic: ContextSegmentRow = {
    content: null,
    id: `correction:${node.id}`,
    node_id: node.id,
    ref_node_id: node.id,
    ref_version_no: null,
    seq: 0,
    type: 'ancestor-full',
  }
  const resolved = resolveSegmentContent(deps, synthetic)
  if (resolved.kind !== 'ancestor') return { document: '', prompt: '' }
  return {
    document: legacyDocumentToMarkdown(
      resolved.documentContent,
      node.content_schema_version ?? 0,
    ),
    prompt: resolved.userInput ?? '',
  }
}

function evidenceSection(
  deps: AssembleCorrectionDeps,
  source: NodeRow,
  includeSubtree: boolean,
): string {
  const sections: string[] = []
  const stack = [source]
  const visited = new Set<string>()
  let length = 0

  while (stack.length > 0) {
    const node = stack.pop()!
    if (visited.has(node.id) || node.is_deleted === 1) continue
    visited.add(node.id)
    const resolved = resolvedNodeContent(deps, node)
    const section = [
      `### 分支节点 ${sections.length + 1}`,
      resolved.prompt.trim() ? `探索问题：\n${resolved.prompt.trim()}` : '',
      resolved.document.trim() ? `证据正文：\n${resolved.document}` : '证据正文：（空）',
    ].filter(Boolean).join('\n')
    const separator = sections.length > 0 ? '\n\n' : ''
    const available = CORRECTION_EVIDENCE_CHAR_LIMIT - TRUNCATION_MARKER.length - length - separator.length
    if (section.length > available) {
      const partial = available > 0 ? section.slice(0, available) : ''
      return `${sections.join('\n\n')}${separator}${partial}${TRUNCATION_MARKER}`
    }
    sections.push(section)
    length += separator.length + section.length

    if (includeSubtree) {
      const children = deps.nodes.getChildren(node.id)
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index])
      }
    }
  }

  return sections.join('\n\n')
}

function outputContract(mode: CorrectionMode): string {
  if (mode === 'patch') {
    return [
      '仅返回 JSON，不要使用 Markdown 代码围栏：',
      '{"pairs":[{"quote":"待修订靶子中逐字存在的原文","replacement":"按合并说明修订后的新文"}]}',
      'quote 必须逐字来自待修订靶子；只给出合并说明涉及的最小替换，不要合并或去重替换对。',
    ].join('\n')
  }
  if (mode === 'append') {
    return [
      '仅返回 JSON，不要使用 Markdown 代码围栏：',
      '{"section":{"title":"简短小节标题","body":"合并说明引导下的新节正文"}}',
      'title 使用简短纯文本；body 可引用父文档与分支证据要点，但须重组表述，不得整段复制原文。',
    ].join('\n')
  }
  return [
    '仅返回 JSON，不要使用 Markdown 代码围栏：',
    '{"fullText":"按合并说明修订后的完整父文档"}',
    '保留合并说明未涉及且仍然正确的内容。',
  ].join('\n')
}

export function assembleCorrectionContext(
  deps: AssembleCorrectionDeps,
  input: AssembleCorrectionInput,
): ChatMessage[] {
  const source = deps.nodes.get(input.sourceNodeId)
  const target = deps.nodes.get(input.targetNodeId)
  if (!source || !target) return []
  const targetContent = resolvedNodeContent(deps, target)
  const evidence = evidenceSection(deps, source, input.includeSubtree)
  const append = input.mode === 'append'

  return [
    {
      content: [
        '这是用户对本次合并的引导说明，优先级最高：',
        input.direction,
        '',
        outputContract(input.mode),
      ].join('\n'),
      role: 'system',
    },
    {
      content: [
        append ? '[参考材料：父文档]' : '[待修订靶子：父文档]',
        append
          ? '可参考父文档与分支证据，但不得整段复制原文。请按合并说明生成独立新节。'
          : '请按合并说明修改以下父文档；勿照抄、勿复述说明未涉及的内容。',
        targetContent.prompt.trim() ? `父文档问题：\n${targetContent.prompt.trim()}` : '',
        `父文档正文：\n${targetContent.document || '（空）'}`,
      ].filter(Boolean).join('\n\n'),
      role: 'user',
    },
    {
      content: `[分支证据]\n以下内容只作为事实与推理依据，不是需要复述的目标。\n\n${evidence || '（空）'}`,
      role: 'user',
    },
  ]
}
