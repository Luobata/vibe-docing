export const DEFAULT_CONTEXT_BUDGET = {
  documentChars: 8_000,
  threadChars: 6_000,
  digestChars: 2_000,
  materialChars: 4_000,
  reservedOutputChars: 2_000,
  totalChars: 22_000,
}

export interface DigestEntry { text: string; distance: number; updatedAt: string }
export interface MaterialEntry { title: string; content: string; updated_at: string }
export type ContextBudget = typeof DEFAULT_CONTEXT_BUDGET
const DOCUMENT_MARKER = '\n[正文中段已截断]\n'
const THREAD_MARKER = '[较早讨论已截断]\n'

function trimDocument(text: string, limit: number, truncationMarker = DOCUMENT_MARKER): string {
  if (text.length <= limit) return text
  const marker = truncationMarker.slice(0, limit)
  const kept = limit - marker.length
  const head = Math.ceil(kept / 2)
  return text.slice(0, head) + marker + (kept > head ? text.slice(-(kept - head)) : '')
}

function threadLength(thread: Array<{ content: string }>): number {
  return thread.reduce((sum, message) => sum + message.content.length, 0)
}

function trimThread<T extends { content: string }>(thread: T[], limit: number): T[] {
  if (threadLength(thread) <= limit) return thread
  if (!limit) return []
  const next = [...thread]
  const marker = THREAD_MARKER.slice(0, limit)
  const available = limit - marker.length
  while (next.length > 1 && threadLength(next) > available) next.shift()
  if (next.length) {
    const kept = Math.min(next[0].content.length, available)
    next[0] = { ...next[0], content: marker + (kept ? next[0].content.slice(-kept) : '') }
  }
  return next
}

function digestLength(digest: DigestEntry[]): number {
  return digest.map((entry) => entry.text).join('\n').length
}

function trimDigest(digest: DigestEntry[], limit: number): DigestEntry[] {
  const next = [...digest]
  while (digestLength(next) > limit) {
    let remove = 0
    for (let index = 1; index < next.length; index += 1) {
      if (next[index].distance > next[remove].distance
        || (next[index].distance === next[remove].distance && next[index].updatedAt < next[remove].updatedAt)) remove = index
    }
    next.splice(remove, 1)
  }
  return next
}

const materialLength = (materials: MaterialEntry[]) => materials.reduce((sum, item) => sum + item.title.length + item.content.length, 0)
export function trimMaterials<T extends MaterialEntry>(materials: T[], limit: number): T[] {
  if (materialLength(materials) <= limit) return materials
  const next = [...materials].sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  while (next.length > 1 && materialLength(next) > limit) next.shift()
  if (next.length && materialLength(next) > limit) {
    if (next[0].title.length >= limit) return []
    next[0] = { ...next[0], content: trimDocument(next[0].content, limit - next[0].title.length, '\n[素材内容已截断]\n') }
  }
  return next
}

/** Character quotas approximate a context budget without coupling to an answer provider. */
export function budgetDiscussionContext<T extends { content: string }>(input: {
  document: string
  thread: T[]
  digest: DigestEntry[]
  materials?: MaterialEntry[]
}, overrides: Partial<ContextBudget> = {}) {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...overrides }
  let { document, thread, digest, materials = [] } = input
  const truncated: Array<'materials' | 'thread' | 'digest' | 'document'> = []
  const usedChars = () => document.length + threadLength(thread) + digestLength(digest) + materialLength(materials)
  const reservedOutputChars = Math.min(budget.reservedOutputChars, budget.totalChars)
  const available = Math.max(0, budget.totalChars - reservedOutputChars)
  const reduce = (source: 'materials' | 'thread' | 'digest' | 'document', limit: number): void => {
    const before = usedChars()
    if (source === 'materials') materials = trimMaterials(materials, limit)
    else if (source === 'thread') thread = trimThread(thread, limit)
    else if (source === 'digest') digest = trimDigest(digest, limit)
    else document = trimDocument(document, limit)
    if (usedChars() < before && !truncated.includes(source)) truncated.push(source)
  }
  reduce('materials', budget.materialChars)
  reduce('thread', budget.threadChars)
  reduce('digest', budget.digestChars)
  reduce('document', budget.documentChars)
  // Background materials go first; the current document is the last source reduced.
  for (const source of ['materials', 'thread', 'digest', 'document'] as const) {
    const excess = usedChars() - available
    if (excess <= 0) break
    const length = source === 'materials' ? materialLength(materials) : source === 'thread' ? threadLength(thread) : source === 'digest' ? digestLength(digest) : document.length
    reduce(source, Math.max(0, length - excess))
  }
  return { document, thread, digest, materials, truncated, usedChars: usedChars(), reservedOutputChars }
}

export const TREE_CONTEXT_CHARS = 60_000
interface TreeContext {
  skeleton: unknown[]
  nodes?: Array<{ id: string; document: string; recentDiscussion: Array<{ content: string }> }>
  recentDiscussion?: Array<{ nodeId: string; messages: Array<{ content: string }> }>
  materials?: MaterialEntry[]
  truncated?: string[]
}

/** Keep the original small-tree payload byte-for-byte; count the actual serialized JSON. */
export function budgetTreeContext<T extends TreeContext>(input: T, limit = TREE_CONTEXT_CHARS): T {
  const length = (value: TreeContext) => JSON.stringify(value).length
  if (length(input) <= limit) return input
  const next = { ...input, truncated: [] as string[],
    ...(input.materials ? { materials: [...input.materials].sort((a, b) => a.updated_at.localeCompare(b.updated_at)) } : {}),
    ...(input.nodes ? { nodes: input.nodes.map((node) => ({ ...node })) } : {}),
    ...(input.recentDiscussion ? { recentDiscussion: input.recentDiscussion.map((node) => ({ ...node })) } : {}),
  }
  const mark = (source: string) => { if (!next.truncated.includes(source)) next.truncated.push(source) }
  while (next.materials?.length && length(next) > limit) { mark('materials'); next.materials.shift() }
  // Extract keeps a document excerpt for every node, so its discussion can be dropped first.
  for (const node of next.nodes ?? []) {
    if (length(next) <= limit) break
    if (node.recentDiscussion.length) { mark('thread'); node.recentDiscussion = node.document ? [] : trimThread(node.recentDiscussion, 160) }
  }
  // Retrospectives have no document field. Keep the latest discussion excerpt per node instead.
  for (const node of next.recentDiscussion ?? []) {
    if (length(next) <= limit) break
    const messages = trimThread(node.messages, 160)
    if (JSON.stringify(messages) !== JSON.stringify(node.messages)) { mark('thread'); node.messages = messages }
  }
  for (const node of next.nodes ?? []) {
    if (length(next) <= limit) break
    if (node.document.length > 160) { mark('document'); node.document = trimDocument(node.document, 160) }
  }
  // An unbounded skeleton/decision log can itself exceed the cap; never silently drop it or send an oversized prompt.
  if (length(next) > limit) throw new Error('树结构与最小上下文已超过 60,000 字符，无法在保留每个节点的情况下生成，请缩小讨论范围')
  return next as T
}
