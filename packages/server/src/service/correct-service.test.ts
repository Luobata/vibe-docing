import { describe, expect, it, vi } from 'vitest'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import { fixedClock } from '../util/clock'
import { createCorrectService } from './correct-service'

function setup() {
  const deps = createDeps({
    clock: fixedClock('2026-08-31T12:00:00.000Z'),
    db: openMemoryDb(),
  })
  const { rootNode, tree } = deps.trees.create('纠正测试')
  const parent = deps.nodes.updateContent(rootNode.id, {
    contentSchemaVersion: 0,
    documentContent: JSON.stringify({
      content: [{ content: [{ text: '旧结论', type: 'text' }], type: 'paragraph' }],
      type: 'doc',
    }),
  })
  const source = deps.nodes.create({ parentId: parent.id, treeId: tree.id, userInput: '分支发现' })
  deps.nodes.updateContent(source.id, { contentSchemaVersion: 2, documentContent: '新证据' })
  return { deps, parent, source }
}

describe('CorrectService', () => {
  it('creates a structured draft without persistence and preserves duplicate pairs', async () => {
    const { deps, parent, source } = setup()
    let messages: Array<{ content: string; role: string }> = []
    const provider = createMockProvider({
      chunks: ['{"pairs":[{"quote":"旧结论","replacement":"新结论"},{"quote":"旧结论","replacement":"补充结论"}]}'],
      onMessages: (value) => { messages = value },
    })

    const draft = await createCorrectService(deps).draft({
      direction: ' 改正结论 ', includeSubtree: true, mode: 'patch', provider, sourceNodeId: source.id,
    })

    expect(draft).toMatchObject({ mode: 'patch', unmatched: { heading: '纠正附注', strategy: 'append-note' } })
    expect(draft.mode === 'patch' && draft.pairs).toHaveLength(2)
    expect(messages[0].content).toContain('这是用户对本次合并的引导说明')
    expect(messages[1].content).toContain('旧结论')
    expect(messages[2].content).toContain('新证据')
    expect(deps.nodes.get(parent.id)?.content_schema_version).toBe(0)
    expect(deps.versions.listByNode(parent.id)).toHaveLength(0)
    expect(deps.merges.listByTarget(parent.id)).toHaveLength(0)
  })

  it('parses an append section draft without persistence', async () => {
    const { deps, parent, source } = setup()
    const provider = createMockProvider({
      chunks: ['{"section":{"title":"补充建议","body":"先验证，再推广。"}}'],
    })

    const draft = await createCorrectService(deps).draft({
      direction: '提炼分支要点补充', includeSubtree: true, mode: 'append', provider, sourceNodeId: source.id,
    })

    expect(draft).toEqual({
      mode: 'append',
      section: { body: '先验证，再推广。', title: '补充建议' },
    })
    expect(deps.nodes.get(parent.id)?.content_schema_version).toBe(0)
    expect(deps.versions.listByNode(parent.id)).toHaveLength(0)
    expect(deps.merges.listByTarget(parent.id)).toHaveLength(0)
  })

  it('commits before/after snapshots, canonical content, and a repeatable correction row', () => {
    const { deps, parent, source } = setup()
    const service = createCorrectService(deps)

    const first = service.commit({
      direction: '改正结论', documentContent: '新结论', sourceNodeId: source.id,
    })
    service.commit({ direction: '再补充', documentContent: '新结论\n\n补充', sourceNodeId: source.id })

    expect(first.node.document_content).toBe('新结论')
    expect(first.node.content_schema_version).toBe(2)
    expect(first.merge).toMatchObject({
      conclusion: '', direction: '改正结论', kind: 'correction', landing_segment_id: null,
      source_node_id: source.id, target_node_id: parent.id,
    })
    const versions = deps.versions.listByNode(parent.id)
    expect(versions.map((version) => [version.change_kind, version.document_content])).toEqual([
      ['correction', '旧结论'],
      ['correction', '新结论'],
      ['correction', '新结论'],
      ['correction', '新结论\n\n补充'],
    ])
    expect(deps.merges.listByTarget(parent.id)).toHaveLength(2)
    expect(deps.segments.listByNode(parent.id)).toHaveLength(0)
    expect(deps.nodes.get(source.id)?.is_deleted).toBe(0)
  })

  it('rolls the node and snapshots back if the correction audit row fails', () => {
    const { deps, parent, source } = setup()
    vi.spyOn(deps.merges, 'record').mockImplementation(() => { throw new Error('audit failed') })

    expect(() => createCorrectService(deps).commit({
      direction: '改正', documentContent: '不应留下', sourceNodeId: source.id,
    })).toThrow('audit failed')

    expect(deps.nodes.get(parent.id)?.content_schema_version).toBe(0)
    expect(deps.versions.listByNode(parent.id)).toHaveLength(0)
    expect(deps.merges.listByTarget(parent.id)).toHaveLength(0)
  })
})
