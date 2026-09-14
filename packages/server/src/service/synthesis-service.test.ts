import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import type { Provider } from '../provider/types'
import { createMockProvider } from '../provider/mock-provider'
import { SYNTHESIS_SECTIONS } from './synthesis-service'

const cleanups: Array<() => void> = []
afterEach(() => { vi.useRealTimers(); cleanups.splice(0).forEach((cleanup) => cleanup()) })
function setup(count = 3) {
  const root = mkdtempSync(join(tmpdir(), 'vibe-synthesis-service-'))
  const deps = createDeps({ db: openMemoryDb(), env: {}, vaultPath: root })
  const { tree, rootNode } = deps.trees.create('Project')
  const nodes = [rootNode, ...Array.from({ length: count - 1 }, (_, index) => deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: `Branch ${index}` }))]
    .map((node, index) => deps.nodes.updateContent(node.id, { documentContent: `OWN_BODY_${index}`, contentSchemaVersion: 2 }))
  cleanups.push(() => { deps.db.close(); rmSync(root, { recursive: true, force: true }) })
  return { deps, tree, nodes, run: (provider: Provider) => deps.synthesis.run(deps.synthesis.prepare(tree.id), provider) }
}
const finalContent = () => JSON.stringify({ sections: [...SYNTHESIS_SECTIONS].reverse().map(({ key }) => ({ key, content: `${key} evidence [^1]` })) })
function provider(onInput: (input: any) => void = () => {}): Provider {
  return { complete: async () => '', async *stream(messages) {
    const input = JSON.parse(messages[1].content)
    onInput(input)
    yield input.sections ? finalContent() : 'Distilled claim'
  } }
}

describe('synthesis service', () => {
  it('keeps small-tree extract and retrospective payloads byte-for-byte equivalent to their prior shapes', async () => {
    const { deps, tree, nodes } = setup(3)
    deps.discussionMessages.append({ nodeId: nodes[1].id, role: 'user', content: 'Discuss this' })
    const question = deps.openQuestions.upsert(tree.id, { question: 'Which route?', source: 'manual' })
    const input = deps.synthesis.prepare(tree.id).input
    const calls: string[] = []
    const model = createMockProvider({ chunks: ['[]'], onMessages: (messages) => { calls.push(messages[1].content) } })
    await deps.synthesis.extractQuestions(tree.id, model)
    await deps.synthesis.retrospective(tree.id, model)
    expect(calls).toEqual([
      JSON.stringify({ skeleton: input.skeleton, nodes: input.nodes.map(({ id, document, thread }) => ({ id, document, recentDiscussion: thread })), existingQuestions: [question] }),
      JSON.stringify({ skeleton: input.skeleton, merges: input.merges, openQuestions: [question], recentDiscussion: input.nodes.map(({ id, thread }) => ({ nodeId: id, messages: thread })) }),
    ])
  })

  it('clamps 25-node extract and retrospective inputs including materials to 60k while retaining the complete skeleton and all node excerpts', async () => {
    const { deps, tree, nodes } = setup(25)
    nodes.forEach((node, index) => {
      deps.nodes.updateContent(node.id, { documentContent: `HEAD${index}` + 'x'.repeat(7900) + `TAIL${index}`, contentSchemaVersion: 2 })
      deps.discussionMessages.append({ nodeId: node.id, role: 'user', content: 't'.repeat(5900) + `LATEST${index}` })
    })
    deps.syntheses.setVerdict(nodes[1].id, 'adopted')
    for (let index = 0; index < 5; index++) deps.materials.create(tree.id, { title: `Source ${index}`, content: String(index).repeat(10_000) })
    const skeleton = deps.synthesis.prepare(tree.id).input.skeleton
    const calls: string[] = []
    const model = createMockProvider({ chunks: ['[]'], onMessages: (messages) => { calls.push(messages[1].content) } })
    await deps.synthesis.extractQuestions(tree.id, model)
    await deps.synthesis.retrospective(tree.id, model)
    for (const raw of calls) {
      expect(raw.length).toBeLessThanOrEqual(60_000)
      expect(JSON.parse(raw).skeleton).toEqual(skeleton)
      expect(JSON.parse(raw).truncated).toContain('materials')
    }
    const extract = JSON.parse(calls[0])
    const recap = JSON.parse(calls[1])
    expect(extract.nodes.map((item: { id: string }) => item.id)).toEqual(skeleton.map((item) => item.id))
    expect(recap.recentDiscussion.map((item: { nodeId: string }) => item.nodeId)).toEqual(skeleton.map((item) => item.id))
    for (const [index, node] of nodes.entries()) {
      const document = extract.nodes.find((item: { id: string }) => item.id === node.id).document
      expect(document).toMatch(new RegExp(`^HEAD${index}[\\s\\S]*TAIL${index}$`))
      expect(recap.recentDiscussion.find((item: { nodeId: string }) => item.nodeId === node.id).messages.at(-1).content).toMatch(new RegExp(`LATEST${index}$`))
    }
  })

  it('includes only enabled materials in tree tools, invalidates retrospective cache on edits, and leaves synthesis input/cache unchanged', async () => {
    const { deps, tree, run } = setup(1)
    const first = await run(provider())
    const material = deps.materials.create(tree.id, { title: 'Source', content: 'PRIVATE_BACKGROUND' }).material
    const disabled = deps.materials.create(tree.id, { content: 'DISABLED_BACKGROUND' }).material
    deps.materials.update(disabled.id, { enabled: false })
    const calls: string[] = []
    const model = createMockProvider({ chunks: ['[]'], onMessages: (messages) => { calls.push(messages[1].content) } })
    await deps.synthesis.extractQuestions(tree.id, model)
    const recap = await deps.synthesis.retrospective(tree.id, model)
    expect((await deps.synthesis.retrospective(tree.id, model)).cached).toBe(true)
    expect(calls).toHaveLength(2)
    calls.forEach((raw) => { expect(raw).toContain('PRIVATE_BACKGROUND'); expect(raw).not.toContain('DISABLED_BACKGROUND') })
    const synthCalls = vi.fn()
    const next = await run(provider(synthCalls))
    expect(synthCalls).not.toHaveBeenCalled()
    expect(next.inputDigest).toBe(first.inputDigest)
    deps.materials.update(material.id, { content: 'UPDATED_BACKGROUND' })
    const updated = await deps.synthesis.retrospective(tree.id, model)
    expect(updated.cached).toBe(false)
    expect(updated.retrospective.id).not.toBe(recap.retrospective.id)
    expect(calls.at(-1)).toContain('UPDATED_BACKGROUND')
    deps.materials.update(material.id, { enabled: false })
    expect((await deps.synthesis.retrospective(tree.id, model)).cached).toBe(false)
    expect(calls.at(-1)).not.toContain('BACKGROUND')
  })

  it.each(['##', '###'])('strips a matching leading %s heading before saving sections and Markdown', async (heading) => {
    const { deps, run } = setup(1)
    const result = await run(createMockProvider({ chunks: [JSON.stringify({
      sections: SYNTHESIS_SECTIONS.map(({ key, title }) => ({ key, content: `${heading}\t ${title} \t\r\n\r\n  ${key} evidence [^1]` })),
    })] }))
    expect(result.status).toBe('done')
    const stored = deps.db.prepare('SELECT content_md, sections_json FROM syntheses WHERE id = ?').get(result.id) as { content_md: string; sections_json: string }
    const sections = JSON.parse(stored.sections_json)
    expect(sections).toEqual(result.sections)
    expect(stored.content_md).toBe(result.contentMd)
    for (const { key, title } of SYNTHESIS_SECTIONS) {
      expect(sections.find((section: { key: string }) => section.key === key).content).toBe(`${key} evidence [^1]`)
      expect(stored.content_md.split('\n').filter((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim() === title)).toEqual([`## ${title}`])
    }
  })

  it('preserves prose, different headings, non-headings and matching headings after the first line in both stored forms', async () => {
    const { deps, run } = setup(1)
    const contents = ['正文开头', '## 别的标题\n\n正文', '####### 决策与理由\n\n正文', '## 被否决方案及原因补充\n\n正文', '#风险\n\n正文', '前言\n\n## 开放问题\n\n正文']
    const result = await run(createMockProvider({ chunks: [JSON.stringify({
      sections: SYNTHESIS_SECTIONS.map(({ key }, index) => ({ key, content: contents[index] })),
    })] }))
    expect(result.status).toBe('done')
    const stored = deps.db.prepare('SELECT content_md, sections_json FROM syntheses WHERE id = ?').get(result.id) as { content_md: string; sections_json: string }
    expect(JSON.parse(stored.sections_json).map((section: { content: string }) => section.content)).toEqual(contents)
    expect(result.sections.map((section) => section.content)).toEqual(contents)
    expect(stored.content_md).toBe(result.contentMd)
    SYNTHESIS_SECTIONS.forEach(({ title }, index) => expect(stored.content_md).toContain(`## ${title}\n\n${contents[index]}`))
  })

  it('runs three nodes concurrently, isolates their input, and synthesizes ordered sections with lineage and decisions', async () => {
    const { deps, tree, nodes, run } = setup(4)
    deps.syntheses.setVerdict(nodes[1].id, 'rejected')
    deps.merges.record({ sourceNodeId: nodes[2].id, targetNodeId: nodes[0].id, conclusion: 'Merged because useful', landingSegmentId: null })
    deps.discussionMessages.append({ nodeId: nodes[1].id, role: 'user', content: 'OWN_DISCUSSION_1' })
    const before = deps.db.prepare('SELECT * FROM nodes ORDER BY id').all()
    const inputs: any[] = []
    let active = 0
    let maximum = 0
    const result = await run({ complete: async () => '', async *stream(messages) {
      const input = JSON.parse(messages[1].content)
      inputs.push(input)
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      yield input.sections ? finalContent() : 'A distilled claim'
    } })
    expect(maximum).toBe(3)
    expect(inputs).toHaveLength(5)
    for (let index = 0; index < nodes.length; index++) {
      const input = inputs.find((item) => item.nodeId === nodes[index].id)
      expect(input.document).toBe(`OWN_BODY_${index}`)
      expect(Object.keys(input).sort()).toEqual(['document', 'nodeId', 'recentDiscussion'])
      if (index === 1) expect(input.recentDiscussion).toEqual([{ role: 'user', content: 'OWN_DISCUSSION_1' }])
      else expect(input.recentDiscussion).toEqual([])
    }
    const final = inputs.at(-1)
    expect(final.skeleton.find((node: any) => node.id === nodes[1].id)).toMatchObject({ parentId: nodes[0].id, depth: 1, verdict: 'rejected', siblingIds: [nodes[2].id, nodes[3].id] })
    expect(final.merges).toMatchObject([{ conclusion: 'Merged because useful' }])
    expect(result.status).toBe('done')
    expect(result.sections.map((section) => section.title)).toEqual(['背景', '核心分歧', '决策与理由', '被否决方案及原因', '风险', '开放问题'])
    expect(result.footnotes).toHaveLength(4)
    expect(result.footnotes[1]).toMatchObject({ nodeId: nodes[1].id, number: 2, path: [result.footnotes[0].title, 'Branch 0'] })
    expect(result.contentMd).toContain(`[^2]: ${nodes[1].id}`)
    expect(deps.db.prepare('SELECT * FROM nodes ORDER BY id').all()).toEqual(before)
    expect(deps.db.prepare('SELECT count(*) AS count FROM node_versions').get()).toEqual({ count: 0 })
  })

  it('creates a new history row with zero model calls for unchanged successful input; invalidates only the changed node', async () => {
    const { deps, tree, nodes, run } = setup()
    const first = await run(provider())
    const calls = vi.fn()
    const second = await run(provider(calls))
    expect(calls).not.toHaveBeenCalled()
    expect(second.id).not.toBe(first.id)
    expect(second.contentMd).toBe(first.contentMd)
    expect(Object.values(second.nodeResults).every((node) => node.cached)).toBe(true)
    // A canonical edit can leave the stored content_hash unchanged.
    deps.nodes.updateContent(nodes[1].id, { documentContent: 'Edited canonical body', contentSchemaVersion: 2 })
    const third = await run(provider(calls))
    expect(calls).toHaveBeenCalledTimes(2)
    expect(calls.mock.calls[0][0]).toMatchObject({ nodeId: nodes[1].id, document: 'Edited canonical body' })
    expect(third.inputDigest).not.toBe(second.inputDigest)
    expect(deps.syntheses.listByTree(tree.id)).toHaveLength(3)
  })

  it('retries failed nodes while retaining successful distillations and reports partial failure', async () => {
    const { deps, nodes, run } = setup()
    const failedId = nodes[1].id
    const first = await run({ complete: async () => '', async *stream(messages) {
      const input = JSON.parse(messages[1].content)
      if (input.nodeId === failedId) throw new Error('node unavailable')
      yield input.sections ? finalContent() : 'Distilled'
    } })
    expect(first.status).toBe('done')
    expect(first.nodeResults[failedId]).toMatchObject({ status: 'failed', error: 'node unavailable' })
    const inputs = vi.fn()
    const retry = await run(provider(inputs))
    expect(inputs).toHaveBeenCalledTimes(2)
    expect(inputs.mock.calls[0][0].nodeId).toBe(failedId)
    expect(Object.values(retry.nodeResults).filter((item) => item.cached)).toHaveLength(2)
    expect(deps.nodes.get(failedId)?.document_content).toBe('OWN_BODY_1')
  })

  it('marks all-node and final-stage failures as failed without discarding completed node caches', async () => {
    const { deps, tree, run } = setup(2)
    const allFailed = await run({ complete: async () => '', async *stream() { throw new Error('unavailable') } })
    expect(allFailed.status).toBe('failed')
    expect(Object.values(allFailed.nodeResults).every((item) => item.status === 'failed')).toBe(true)
    const malformed = await run(createMockProvider({ chunks: ['not JSON'] }))
    expect(malformed).toMatchObject({ status: 'failed', contentMd: null })
    expect(Object.values(malformed.nodeResults).every((item) => item.status === 'done')).toBe(true)
    const calls = vi.fn()
    expect((await run(provider(calls))).status).toBe('done')
    expect(calls).toHaveBeenCalledOnce()
    expect(deps.syntheses.listByTree(tree.id)).toHaveLength(3)
  })

  it('invalidates distillation on a new discussion message and final synthesis on a verdict change', async () => {
    const { deps, nodes, run } = setup(2)
    await run(provider())
    deps.discussionMessages.append({ nodeId: nodes[1].id, role: 'assistant', content: 'New conclusion' })
    const calls = vi.fn()
    await run(provider(calls))
    expect(calls).toHaveBeenCalledTimes(2)
    calls.mockClear()
    deps.syntheses.setVerdict(nodes[1].id, 'adopted')
    await run(provider(calls))
    expect(calls).toHaveBeenCalledOnce()
    expect(calls.mock.calls[0][0].skeleton[1].verdict).toBe('adopted')
  })

  it.each([['0', 1], ['9', 4], ['invalid', 3]])('clamps concurrency setting %s to %i', async (setting, expected) => {
    const { deps, run } = setup(5)
    deps.settings.set('synthesis.concurrency', setting as string)
    let active = 0
    let maximum = 0
    await run({ complete: async () => '', async *stream(messages) {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      yield JSON.parse(messages[1].content).sections ? finalContent() : 'Distilled'
    } })
    expect(maximum).toBe(expected)
  })

  it('uses the 90-second idle deadline and cleans up even when the provider ignores abort', async () => {
    const { run } = setup(1)
    let observed: AbortSignal | undefined
    vi.useFakeTimers()
    const pending = run({ complete: async () => '', async *stream(_messages, options) {
      observed = options?.signal
      await new Promise<void>(() => {})
    } })
    await vi.advanceTimersByTimeAsync(89_999)
    expect(observed?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.status).toBe('failed')
    expect(Object.values(result.nodeResults)[0].error).toBe('讨论生成超过 90 秒没有响应，请重试')
    expect(observed?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels promptly via request signal, preserves completed nodes and resumes without a task registry', async () => {
    const { deps, tree, nodes, run } = setup(2)
    deps.settings.set('synthesis.concurrency', '1')
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    const controller = new AbortController()
    const prepared = deps.synthesis.prepare(tree.id)
    const pending = deps.synthesis.run(prepared, { complete: async () => '', async *stream(messages) {
      if (JSON.parse(messages[1].content).nodeId === nodes[1].id) { started(); await new Promise<void>(() => {}) }
      yield 'Done first'
    } }, controller.signal)
    await waiting
    controller.abort(new Error('User stopped'))
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(Object.keys(result.nodeResults)).toEqual([nodes[0].id])
    const calls = vi.fn()
    expect((await run(provider(calls))).status).toBe('done')
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('reuses retrospective input digest and invalidates it on question state or discussion changes', async () => {
    const { deps, tree, nodes } = setup(1)
    const calls = vi.fn()
    const model = createMockProvider({ chunks: ['## 回顾\nNext step'], onMessages: calls })
    const first = await deps.synthesis.retrospective(tree.id, model)
    const cached = await deps.synthesis.retrospective(tree.id, model)
    expect(cached).toEqual({ ...first, cached: true })
    expect(calls).toHaveBeenCalledOnce()
    const question = deps.openQuestions.upsert(tree.id, { question: 'Which option?', source: 'manual' })
    await deps.synthesis.retrospective(tree.id, model)
    deps.openQuestions.update(question.id, { status: 'resolved' })
    await deps.synthesis.retrospective(tree.id, model)
    deps.discussionMessages.append({ nodeId: nodes[0].id, role: 'user', content: 'New topic' })
    await deps.synthesis.retrospective(tree.id, model)
    expect(calls).toHaveBeenCalledTimes(4)
    expect(deps.db.prepare('SELECT COUNT(*) AS count FROM retrospectives').get()).toEqual({ count: 4 })
  })

  it.each([['adopted', '[已采纳]'], ['rejected', '[已否决]'], ['superseded', '[已替代]']] as const)('includes %s and merged markers in the existing discussion digest', async (verdict, marker) => {
    const { deps, nodes } = setup(3)
    deps.syntheses.setVerdict(nodes[1].id, verdict)
    deps.merges.record({ sourceNodeId: nodes[1].id, targetNodeId: nodes[0].id, conclusion: 'Recorded', landingSegmentId: null })
    const calls = vi.fn()
    await deps.discussion.discuss({ nodeId: nodes[2].id, userInput: 'Question', provider: createMockProvider({ chunks: ['Answer'], onMessages: calls }) }, () => {})
    const messages = JSON.stringify(calls.mock.calls[0][0])
    expect(messages).toContain(`[已合并] ${marker}`)
  })
})
