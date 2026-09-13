import { describe, expect, it } from 'vitest'
import { budgetDiscussionContext, DEFAULT_CONTEXT_BUDGET } from './context-budget'

describe('discussion context budget', () => {
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
