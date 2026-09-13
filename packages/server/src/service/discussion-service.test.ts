import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { plainTextToProseMirror, type NodeRow } from '@vibe/shared'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { createMockProvider } from '../provider/mock-provider'
import { saveDocumentContent } from '../routes/document-content'
import { DiscussionError } from './discussion-service'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-discussion-service-'))
  const deps = createDeps({ db: openMemoryDb(), vaultPath: root, env: {} })
  deps.settings.set('vault.path', root)
  cleanups.push(() => { deps.db.close(); rmSync(root, { recursive: true, force: true }) })
  const node = deps.trees.create('Discussion').rootNode
  function content(node: NodeRow, source: string): NodeRow {
    return deps.vault.writeNode(deps.nodes.updateContent(node.id, { documentContent: source, contentSchemaVersion: 2 }), source, 'markdown')
  }
  const main = content(node, '# Main\n\nBody remains.\n')
  const user = deps.discussionMessages.append({ nodeId: main.id, role: 'user', content: 'New proposal' })
  return { deps, main, user, content }
}

describe('discussion service', () => {
  it('maps a promotion provider rejection to 502 while preserving its message and persisted state', async () => {
    const { deps, main, user } = setup()
    const provider = { complete: async () => '', async *stream() {
      yield 'unfinished proposal'
      throw new Error('provider connection reset')
    } }
    const pending = deps.discussion.promote({ nodeId: main.id, mode: 'child', messageIds: [user.id], provider })
    await expect(pending).rejects.toBeInstanceOf(DiscussionError)
    await expect(pending).rejects.toMatchObject({ statusCode: 502, message: 'provider connection reset' })
    expect(deps.nodes.getChildren(main.id)).toEqual([])
    expect(deps.nodes.get(main.id)).toEqual(main)
    expect(deps.discussionMessages.listByNode(main.id)).toEqual([user])
    expect(deps.versions.listByNode(main.id)).toEqual([])
    expect(readFileSync(join(main.vault_root!, main.file_path!), 'utf8')).toBe(main.document_content)
  })

  it('maps the promotion watchdog abort to 502 with its readable timeout message', async () => {
    const { deps, main, user } = setup()
    let signal: AbortSignal | undefined
    const provider = { complete: async () => '', async *stream(_messages: unknown, options?: { signal?: AbortSignal }) {
      signal = options?.signal
      await new Promise<void>(() => {})
    } }
    vi.useFakeTimers()
    try {
      const pending = deps.discussion.promote({ nodeId: main.id, mode: 'section', messageIds: [user.id], baseRevision: main.content_revision, provider })
      const rejection = expect(pending).rejects.toMatchObject({ statusCode: 502, message: '讨论生成超过 45 秒没有响应，请重试' })
      await vi.advanceTimersByTimeAsync(44_999)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await rejection
      await expect(pending).rejects.toBeInstanceOf(DiscussionError)
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      expect(deps.nodes.get(main.id)).toEqual(main)
      expect(deps.discussionMessages.listByNode(main.id)).toEqual([user])
      expect(deps.versions.listByNode(main.id)).toEqual([])
      expect(readFileSync(join(main.vault_root!, main.file_path!), 'utf8')).toBe(main.document_content)
    } finally { vi.useRealTimers() }
  })

  it('preserves caller cancellation during promotion instead of mapping it to a provider failure', async () => {
    const { deps, main, user } = setup()
    const controller = new AbortController()
    const reason = new Error('caller cancelled')
    const provider = { complete: async () => '', async *stream() {
      yield 'partial'
      controller.abort(reason)
    } }
    await expect(deps.discussion.promote({ nodeId: main.id, mode: 'child', messageIds: [user.id], provider, signal: controller.signal })).rejects.toBe(reason)
    expect(deps.nodes.getChildren(main.id)).toEqual([])
    expect(deps.discussionMessages.listByNode(main.id)).toEqual([user])
  })

  it('includes recent siblings and ancestor siblings with merge markers, excluding the active branch', () => {
    const { deps, main, content } = setup()
    const sibling = content(deps.nodes.create({ treeId: main.tree_id, parentId: main.id, userInput: 'Sibling' }), 'Sibling conclusion\nDetails')
    const branch = content(deps.nodes.create({ treeId: main.tree_id, parentId: main.id, userInput: 'Active ancestor' }), 'Ancestor body')
    const current = content(deps.nodes.create({ treeId: main.tree_id, parentId: branch.id, userInput: 'Current' }), 'Current body')
    const near = content(deps.nodes.create({ treeId: main.tree_id, parentId: branch.id, userInput: 'Nearby' }), 'Nearby conclusion')
    deps.db.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', sibling.id)
    deps.merges.record({ sourceNodeId: sibling.id, targetNodeId: main.id, conclusion: 'Merged', landingSegmentId: null })
    const { budget, messages } = deps.discussion.assembleDiscussionContext(current)
    expect(budget.digest).toMatchObject([
      { text: 'Sibling：Sibling conclusion [已合并]', distance: 2 },
      { text: 'Nearby：Nearby conclusion', distance: 1 },
    ])
    expect(messages.find((message) => message.content.startsWith('[分支摘要]'))?.content).not.toContain('Active ancestor')
    expect(deps.discussion.assembleDiscussionContext(main).budget.digest).toEqual([])
    expect(deps.discussion.assembleDiscussionContext(main).messages.some((message) => message.content.startsWith('[分支摘要]'))).toBe(false)
    expect(near.id).not.toBe(current.id)
  })

  it('takes the latest 20 messages and honors discussion-only budget settings', () => {
    const { deps, main } = setup()
    for (let index = 0; index < 22; index += 1) deps.discussionMessages.append({ nodeId: main.id, role: 'user', content: `message ${index}` })
    const context = deps.discussion.assembleDiscussionContext(main)
    expect(context.budget.thread).toHaveLength(20)
    expect(context.budget.thread[0].content).toBe('message 2')
    deps.settings.set('discussion.context.threadChars', '35')
    deps.settings.set('discussion.context.documentChars', '20')
    const limited = deps.discussion.assembleDiscussionContext(main)
    expect(limited.budget.thread.map((message) => message.content).join('').length).toBeLessThanOrEqual(35)
    expect(limited.budget.thread.at(-1)?.content).toContain('message 21')
    expect(limited.budget.document.length).toBeLessThanOrEqual(20)
    expect(deps.context.assemble(main.id, 'unchanged answer context')).toEqual([{ role: 'user', content: 'unchanged answer context' }])
  })

  it('does not let an unchanged vault file overwrite generated JSON while assembling a discussion', async () => {
    const { deps, main } = setup()
    const generated = deps.nodes.updateGeneration(main.id, { aiResponse: plainTextToProseMirror('Generated body'), status: 'complete' })
    const provider = createMockProvider({ chunks: ['response'], onMessages: (messages) => {
      expect(messages.find((message) => message.content.startsWith('[当前文档]'))?.content).toBe('[当前文档]\nGenerated body')
    } })
    await deps.discussion.discuss({ nodeId: main.id, userInput: 'Discuss', provider }, () => {})
    expect(deps.nodes.get(main.id)).toEqual(generated)
  })

  it('keeps the user message and omits the unfinished assistant on abort', async () => {
    const { deps, main } = setup()
    const controller = new AbortController()
    const before = deps.discussionMessages.listByNode(main.id).length
    await expect(deps.discussion.discuss({ nodeId: main.id, userInput: 'Stop me', provider: createMockProvider({ chunks: ['partial', 'never'] }), signal: controller.signal }, () => controller.abort()))
      .rejects.toThrow()
    expect(deps.discussionMessages.listByNode(main.id).slice(before)).toMatchObject([{ role: 'user', content: 'Stop me' }])
  })

  it('promotes selected messages to a child with a version, vault file, and lineage', async () => {
    const { deps, main, user } = setup()
    const result = await deps.discussion.promote({ nodeId: main.id, mode: 'child', messageIds: [user.id], provider: createMockProvider({ chunks: ['# New document\n\n', 'Distilled proposal'] }) })
    expect(result.node).toMatchObject({ parent_id: main.id, tree_id: main.tree_id, user_input: 'New document', content_schema_version: 2, document_content: '# New document\n\nDistilled proposal' })
    expect(deps.nodes.get(main.id)).toEqual(main)
    expect(deps.versions.listByNode(result.node.id)).toHaveLength(1)
    expect(readFileSync(join(result.node.vault_root!, result.node.file_path!), 'utf8')).toBe(result.node.document_content)
    expect(deps.discussionMessages.listByNode(main.id)[0]).toMatchObject({ promoted_node_id: result.node.id, promoted_mode: 'child' })
  })

  it('appends a section through the save pipeline, preserving prefix, anchors, snapshot, and hash', async () => {
    const { deps, main, user } = setup()
    const from = main.document_content!.indexOf('Body')
    const annotation = deps.annotations.create({ nodeId: main.id, kind: 'selection', anchorFrom: from, anchorTo: from + 4, quotedText: 'Body' })
    const result = await deps.discussion.promote({ nodeId: main.id, mode: 'section', messageIds: [user.id], baseRevision: main.content_revision, provider: createMockProvider({ chunks: ['## Proposal\n\nNew prose.'] }) })
    const expected = main.document_content + '\n## Proposal\n\nNew prose.'
    expect(result.node.document_content).toBe(expected)
    expect(result.content.revision).toBe(main.content_revision! + 1)
    expect(deps.annotations.get(annotation.id)).toMatchObject({ anchor_from: from, anchor_to: from + 4, anchor_status: 'valid' })
    expect(deps.versions.listByNode(main.id)).toMatchObject([{ document_content: expected, content_revision: result.content.revision }])
    expect(readFileSync(join(main.vault_root!, main.file_path!), 'utf8')).toBe(expected)
    expect(result.node.content_hash).toBe(createHash('sha256').update(expected).digest('hex'))
    expect(result.messages[0]).toMatchObject({ promoted_node_id: main.id, promoted_mode: 'section' })
  })

  it('keeps a concurrent edit and returns 409 without marking the discussion promoted', async () => {
    const { deps, main, user } = setup()
    let currentRevision = 0
    const provider = createMockProvider({ chunks: ['## Proposal'], onMessages: () => {
      const saved = saveDocumentContent(deps, main.id, { source: 'Concurrent edit', schemaVersion: 2, fileKind: 'markdown', baseRevision: main.content_revision, editSessionId: 'concurrent-edit' })
      if (saved.statusCode !== 200) throw new Error('fixture save failed')
      currentRevision = saved.body.content.revision
    } })
    await expect(deps.discussion.promote({ nodeId: main.id, mode: 'section', messageIds: [user.id], baseRevision: main.content_revision, provider }))
      .rejects.toMatchObject({ statusCode: 409, details: { currentRevision } })
    expect(deps.nodes.get(main.id)?.document_content).toBe('Concurrent edit')
    expect(deps.discussionMessages.listByNode(main.id)[0].promoted_mode).toBeNull()
    expect(deps.versions.listByNode(main.id)).toHaveLength(1)
  })

  it('retains externally hydrated state when promotion returns a late 409', async () => {
    const { deps, main, user } = setup()
    const path = join(main.vault_root!, main.file_path!)
    const provider = createMockProvider({ chunks: ['## Proposal'], onMessages: () => {
      writeFileSync(path, 'External edit')
      const later = new Date(Date.now() + 10_000)
      utimesSync(path, later, later)
    } })
    await expect(deps.discussion.promote({ nodeId: main.id, mode: 'section', messageIds: [user.id], baseRevision: main.content_revision, provider })).rejects.toMatchObject({ statusCode: 409 })
    expect(deps.nodes.get(main.id)?.document_content).toBe('External edit')
    expect(deps.nodes.get(main.id)?.content_revision).toBe(main.content_revision! + 1)
    expect(deps.discussionMessages.listByNode(main.id)[0].promoted_mode).toBeNull()
  })

  it('rejects stale revisions and foreign message selections before calling the provider', async () => {
    const { deps, main, user } = setup()
    const called = vi.fn()
    const provider = createMockProvider({ onMessages: called })
    await expect(deps.discussion.promote({ nodeId: main.id, mode: 'section', messageIds: [user.id], baseRevision: 0, provider })).rejects.toMatchObject({ statusCode: 409 })
    await expect(deps.discussion.promote({ nodeId: main.id, mode: 'child', messageIds: ['missing'], provider })).rejects.toMatchObject({ statusCode: 400 })
    expect(called).not.toHaveBeenCalled()
    expect(deps.nodes.getChildren(main.id)).toEqual([])
  })
})
