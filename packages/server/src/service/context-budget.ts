export const DEFAULT_CONTEXT_BUDGET = {
  documentChars: 8_000,
  threadChars: 6_000,
  digestChars: 2_000,
  reservedOutputChars: 2_000,
  totalChars: 18_000,
}

export interface DigestEntry { text: string; distance: number; updatedAt: string }
export type ContextBudget = typeof DEFAULT_CONTEXT_BUDGET
const DOCUMENT_MARKER = '\n[正文中段已截断]\n'
const THREAD_MARKER = '[较早讨论已截断]\n'

function trimDocument(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = DOCUMENT_MARKER.slice(0, limit)
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

/** Character quotas approximate a context budget without coupling to an answer provider. */
export function budgetDiscussionContext<T extends { content: string }>(input: {
  document: string
  thread: T[]
  digest: DigestEntry[]
}, overrides: Partial<ContextBudget> = {}) {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...overrides }
  let { document, thread, digest } = input
  const truncated: Array<'thread' | 'digest' | 'document'> = []
  const usedChars = () => document.length + threadLength(thread) + digestLength(digest)
  const reservedOutputChars = Math.min(budget.reservedOutputChars, budget.totalChars)
  const available = Math.max(0, budget.totalChars - reservedOutputChars)
  const reduce = (source: 'thread' | 'digest' | 'document', limit: number): void => {
    const before = usedChars()
    if (source === 'thread') thread = trimThread(thread, limit)
    else if (source === 'digest') digest = trimDigest(digest, limit)
    else document = trimDocument(document, limit)
    if (usedChars() < before && !truncated.includes(source)) truncated.push(source)
  }
  reduce('thread', budget.threadChars)
  reduce('digest', budget.digestChars)
  reduce('document', budget.documentChars)
  // Under a tighter shared cap, sacrifice old discussion, then remote branches,
  // and only then the middle of the current document.
  for (const source of ['thread', 'digest', 'document'] as const) {
    const excess = usedChars() - available
    if (excess <= 0) break
    const length = source === 'thread' ? threadLength(thread) : source === 'digest' ? digestLength(digest) : document.length
    reduce(source, Math.max(0, length - excess))
  }
  return { document, thread, digest, truncated, usedChars: usedChars(), reservedOutputChars }
}
