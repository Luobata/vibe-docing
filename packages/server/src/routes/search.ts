import type { DecoratedApp } from '../app'
import type { NodeRow } from '@vibe/shared'

export interface SearchHit {
  nodeId: string
  snippet: string
  title: string
  treeId: string
  treeTitle: string
}

const MAX_QUERY_LENGTH = 80
const RESULT_LIMIT = 20
const SNIPPET_RADIUS = 40

function plainText(value: string | null): string {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) return value
  } catch {
    return value
  }
  return value
}

function snippetAround(haystack: string, needle: string): string {
  const index = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return haystack.slice(0, SNIPPET_RADIUS * 2).trim()
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(haystack.length, index + needle.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end).replace(/\s+/g, ' ').trim()}${end < haystack.length ? '…' : ''}`
}

export function registerSearchRoutes(app: DecoratedApp): void {
  app.get('/api/search', async (request) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const query = (url.searchParams.get('q') ?? '').trim()
    if (query.length < 2) return { hits: [] as SearchHit[] }

    const needle = query.slice(0, MAX_QUERY_LENGTH).replace(/[%_\\]/g, (ch: string) => `\\${ch}`)
    const pattern = `%${needle}%`
    const rows = app.deps.db
      .prepare(
        `SELECT nodes.*, trees.title AS tree_title
         FROM nodes
         JOIN trees ON trees.id = nodes.tree_id
         WHERE nodes.is_deleted = 0 AND trees.is_deleted = 0
           AND (
             nodes.user_input LIKE ? ESCAPE '\\'
             OR nodes.ai_response LIKE ? ESCAPE '\\'
             OR IFNULL(nodes.document_content, '') LIKE ? ESCAPE '\\'
           )
         ORDER BY nodes.updated_at DESC, nodes.id DESC
         LIMIT ${RESULT_LIMIT}`,
      )
      .all(pattern, pattern, pattern) as Array<NodeRow & { tree_title: string }>

    const hits: SearchHit[] = rows.map((row) => {
      const title = row.user_input?.split('\n')[0]?.trim() || (row.parent_id ? '未命名笔记' : row.tree_title || '根笔记')
      const haystack = plainText(row.user_input ?? '') + '\n' + plainText(row.document_content ?? row.ai_response)
      return {
        nodeId: row.id,
        snippet: snippetAround(haystack, query.slice(0, MAX_QUERY_LENGTH)),
        title: title.slice(0, 120),
        treeId: row.tree_id,
        treeTitle: (row as { tree_title?: string }).tree_title ?? '',
      }
    })
    return { hits }
  })
}
