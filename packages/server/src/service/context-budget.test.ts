import { describe, expect, it } from 'vitest'
import { budgetDiscussionContext, budgetTreeContext, DEFAULT_CONTEXT_BUDGET, trimMaterials } from './context-budget'

describe('discussion context budget', () => {
  it('adds an independent 4k materials quota to the 22k cap without displacing existing sources', () => {
    const input = { document: 'd'.repeat(8000), thread: [{ content: 't'.repeat(6000) }], digest: [{ text: 'g'.repeat(2000), distance: 1, updatedAt: 'now' }], materials: [{ title: '', content: 'm'.repeat(4000), updated_at: 'now' }] }
    const result = budgetDiscussionContext(input)
    expect(result).toMatchObject({ ...input, truncated: [], usedChars: 20_000, reservedOutputChars: 2000 })
    expect(DEFAULT_CONTEXT_BUDGET.totalChars).toBe(22_000)
  })

  it('drops the oldest material first regardless of input order, then trims the newest oversized material', () => {
    const old = { title: 'Old', content: 'old'.repeat(100), updated_at: '2020' }
    const fresh = { title: 'New', content: 'HEAD' + 'new'.repeat(3000) + 'TAIL', updated_at: '2026' }
    const result = trimMaterials([fresh, old], 4000)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: 'New', updated_at: '2026' })
    expect(result[0].title.length + result[0].content.length).toBe(4000)
    expect(result[0].content).toMatch(/^HEAD[\s\S]*TAIL$/)
    expect(result[0].content).toContain('[素材内容已截断]')
    expect(fresh.content).toHaveLength(9008)
    expect(trimMaterials([old], 0)).toEqual([])
  })

  it('sacrifices materials, thread, digest, then document under a tight combined cap', () => {
    const result = budgetDiscussionContext({ document: 'HEAD' + 'x'.repeat(100) + 'TAIL', thread: [{ content: 't'.repeat(100) }],
      digest: [{ text: 'd'.repeat(100), distance: 1, updatedAt: 'now' }], materials: [{ title: 'source', content: 'm'.repeat(100), updated_at: 'now' }] },
    { totalChars: 100, reservedOutputChars: 50 })
    expect(result.truncated).toEqual(['materials', 'thread', 'digest', 'document'])
    expect(result).toMatchObject({ materials: [], thread: [], digest: [], usedChars: 50 })
    expect(result.document).toMatch(/^HEAD[\s\S]*TAIL$/)
  })

  it('keeps sources unchanged within quotas and reserves output capacity', () => {
    const input = { document: 'body', thread: [{ content: 'question' }], digest: [{ text: 'branch', distance: 1, updatedAt: 'now' }] }
    expect(budgetDiscussionContext(input)).toMatchObject({ ...input, truncated: [], usedChars: 18, reservedOutputChars: 2000 })
    expect(input.thread).toEqual([{ content: 'question' }])
  })

  it('degrades each oversized source in order, keeping recent discussion and document ends', () => {
    const result = budgetDiscussionContext({
      document: 'HEAD' + 'x'.repeat(10_000) + 'TAIL',
      thread: [{ content: 'old'.repeat(3_000) }, { content: 'recent' }],
      digest: [
        { text: 'near'.repeat(400), distance: 1, updatedAt: 'old' },
        { text: 'far'.repeat(400), distance: 2, updatedAt: 'new' },
      ],
    })
    expect(result.truncated).toEqual(['thread', 'digest', 'document'])
    expect(result.thread).toEqual([{ content: '[较早讨论已截断]\nrecent' }])
    expect(result.digest.map((entry) => entry.distance)).toEqual([1])
    expect(result.document.startsWith('HEAD')).toBe(true)
    expect(result.document.endsWith('TAIL')).toBe(true)
    expect(result.document).toContain('[正文中段已截断]')
    expect(result.document.length).toBe(DEFAULT_CONTEXT_BUDGET.documentChars)
    expect(result.usedChars + result.reservedOutputChars).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.totalChars)
  })

  it('uses thread, digest, then document to meet a tighter total cap', () => {
    const result = budgetDiscussionContext({
      document: 'HEAD' + 'x'.repeat(100) + 'TAIL',
      thread: [{ content: 't'.repeat(100) }],
      digest: [{ text: 'd'.repeat(100), distance: 1, updatedAt: 'now' }],
    }, { totalChars: 100, reservedOutputChars: 50 })
    expect(result.truncated).toEqual(['thread', 'digest', 'document'])
    expect(result.thread).toEqual([])
    expect(result.digest).toEqual([])
    expect(result.document).toMatch(/^HEAD[\s\S]*TAIL$/)
    expect(result.usedChars).toBe(50)
  })

  it('limits a single oversized message and supports an empty input allowance', () => {
    const input = { document: 'body', thread: [{ content: 'x'.repeat(7000) + 'LATEST' }], digest: [] }
    const result = budgetDiscussionContext(input)
    expect(result.thread[0].content.length).toBe(6000)
    expect(result.thread[0].content).toMatch(/LATEST$/)
    expect(budgetDiscussionContext(input, { totalChars: 100, reservedOutputChars: 100 }).usedChars).toBe(0)
    expect(budgetDiscussionContext(input, { totalChars: 100, reservedOutputChars: 200 }))
      .toMatchObject({ usedChars: 0, reservedOutputChars: 100 })
  })
})

describe('tree context budget', () => {
  it('returns the same small-tree payload and serialization with or without materials', () => {
    for (const input of [{ skeleton: [{ id: 'n' }], nodes: [{ id: 'n', document: 'body', recentDiscussion: [] }] },
      { skeleton: [], materials: [{ title: 'source', content: 'background', updated_at: 'now' }] }]) {
      expect(budgetTreeContext(input)).toBe(input)
      expect(JSON.stringify(budgetTreeContext(input))).toBe(JSON.stringify(input))
    }
  })

  it('bounds actual escaped JSON for 25 nodes, preserves skeleton and every document excerpt, and does not mutate inputs', () => {
    const input = { skeleton: Array.from({ length: 25 }, (_, i) => ({ id: String(i), parentId: i ? '0' : null, verdict: null })),
      nodes: Array.from({ length: 25 }, (_, i) => ({ id: String(i), document: `HEAD${i}` + '\\"\n'.repeat(2600) + `TAIL${i}`, recentDiscussion: [{ content: 't'.repeat(6000) }] })),
      materials: [{ title: 'source', content: 'm'.repeat(50_000), updated_at: 'now' }] }
    const before = JSON.stringify(input)
    const result = budgetTreeContext(input)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(60_000)
    expect(result.skeleton).toEqual(input.skeleton)
    expect(result.nodes).toHaveLength(25)
    result.nodes.forEach((node, i) => { expect(node.document).toMatch(new RegExp(`^HEAD${i}[\\s\\S]*TAIL${i}$`)); expect(node.recentDiscussion).toEqual([]) })
    expect(JSON.stringify(input)).toBe(before)
    expect(result).toMatchObject({ truncated: ['materials', 'thread', 'document'] })
  })

  it('keeps a latest discussion excerpt when a node has no document and refuses an irreducible oversized skeleton', () => {
    const input = { skeleton: [{ id: 'n' }], nodes: [{ id: 'n', document: '', recentDiscussion: [{ content: 'x'.repeat(70_000) + 'LATEST' }] }] }
    const result = budgetTreeContext(input)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(60_000)
    expect(result.nodes[0].recentDiscussion[0].content).toMatch(/LATEST$/)
    expect(() => budgetTreeContext({ skeleton: [{ title: 'x'.repeat(60_001) }] })).toThrow('保留每个节点')
  })
})
