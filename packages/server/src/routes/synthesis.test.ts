import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp, type DecoratedApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { createMockProvider } from '../provider/mock-provider'
import type { AppReply, RouteHandler } from '../http/app-instance'
import { SYNTHESIS_SECTIONS } from '../service/synthesis-service'
import { registerSynthesisRoutes } from './synthesis'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup() })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-synthesis-route-'))
  const deps = createDeps({ db: openMemoryDb(), env: {}, vaultPath: root })
  const { tree, rootNode } = deps.trees.create('Project')
  const child = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: 'Option' })
  deps.providerOverride = { complete: async () => '', async *stream(messages) {
    yield JSON.parse(messages[1].content).sections
      ? JSON.stringify({ sections: SYNTHESIS_SECTIONS.map(({ key }) => ({ key, content: 'Evidence [^1]' })) }) : 'Distilled'
  } }
  const app = buildApp(deps)
  cleanups.push(async () => { await app.close(); deps.db.close(); rmSync(root, { recursive: true, force: true }) })
  return { app, deps, tree, rootNode, child }
}
function events(body: string): Array<Record<string, any>> {
  return body.trim().split('\n\n').filter(Boolean).map((frame) => JSON.parse(frame.slice(6)))
}

describe('synthesis routes', () => {
  it('streams node progress, preserves history on a cached rerun, and serves history and shared line diff', async () => {
    const { app, deps, tree } = setup()
    const first = await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/synthesize` })
    expect(first.statusCode).toBe(200)
    expect(first.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    const frames = events(first.body)
    expect(frames.map((frame) => frame.type)).toEqual(['started', 'progress', 'progress', 'phase', 'done'])
    expect(frames.filter((frame) => frame.type === 'progress')).toMatchObject([
      { completed: 1, total: 2, failed: 0, status: 'done', cached: false },
      { completed: 2, total: 2, failed: 0, status: 'done', cached: false },
    ])
    const firstResult = frames.at(-1)!.synthesis
    const called = vi.fn()
    deps.providerOverride = createMockProvider({ onMessages: called })
    const secondResult = events((await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/synthesize` })).body).at(-1)!.synthesis
    expect(called).not.toHaveBeenCalled()
    expect(secondResult.id).not.toBe(firstResult.id)
    expect((await app.inject({ method: 'GET', url: `/api/trees/${tree.id}/syntheses` })).json().syntheses).toHaveLength(2)
    expect((await app.inject({ method: 'GET', url: `/api/syntheses/${firstResult.id}` })).json().synthesis).toEqual(firstResult)
    const diff = (await app.inject({ method: 'GET', url: `/api/syntheses/${secondResult.id}/diff/${firstResult.id}` })).json().lines
    expect(diff.length).toBeGreaterThan(1)
    expect(diff.every((line: any) => line.type === 'same')).toBe(true)
    const cancelledDone = (await app.inject({ method: 'POST', url: `/api/syntheses/${firstResult.id}/cancel` })).json().synthesis
    expect(cancelledDone.status).toBe('done')
  })

  it('emits heartbeats during silence, rejects a second active task, and cancels via persistent state', async () => {
    const { app, deps, tree } = setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const signals: AbortSignal[] = []
    deps.providerOverride = { complete: async () => '', async *stream(_messages, options) {
      signals.push(options!.signal!)
      started()
      await new Promise<void>(() => {})
    } }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pending = Promise.resolve(app.inject({ method: 'POST', url: `/api/trees/${tree.id}/synthesize` }))
    await ready
    const active = deps.syntheses.listByTree(tree.id)[0]
    const duplicate = await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/synthesize` })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toMatchObject({ code: 'SYNTHESIS_RUNNING', synthesisId: active.id })
    await vi.advanceTimersByTimeAsync(20_000)
    const cancel = await app.inject({ method: 'POST', url: `/api/syntheses/${active.id}/cancel` })
    expect(cancel.json().synthesis.status).toBe('cancelled')
    await vi.advanceTimersByTimeAsync(1_000)
    const frames = events((await pending).body)
    expect(frames.filter((frame) => frame.type === 'ping')).toHaveLength(2)
    expect(frames.at(-1)).toMatchObject({ type: 'cancelled', synthesis: { status: 'cancelled' } })
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(deps.syntheses.listByTree(tree.id)).toHaveLength(1)
  })

  it.each(['request', 'reply'] as const)('cleans up and cancels on %s disconnect', async (source) => {
    const { deps, tree } = setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const signals: AbortSignal[] = []
    deps.providerOverride = { complete: async () => '', async *stream(_messages, options) {
      signals.push(options!.signal!); started(); await new Promise<void>(() => {})
    } }
    const handlers = new Map<string, RouteHandler>()
    registerSynthesisRoutes({ deps, get() {}, patch() {}, post(path: string, handler: RouteHandler) { handlers.set(path, handler) } } as unknown as DecoratedApp)
    const requestRaw = Object.assign(new EventEmitter(), { aborted: false, socket: { destroyed: false } })
    const writes: string[] = []
    const replyRaw = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, end: vi.fn(), writeHead: vi.fn(),
      write(chunk: string) { writes.push(chunk); return false } })
    const pending = handlers.get('/api/trees/:id/synthesize')!({ method: 'POST', url: '', params: { id: tree.id }, body: {}, raw: requestRaw }, { hijack() {}, raw: replyRaw } as unknown as AppReply)
    await ready
    replyRaw.destroyed = true
    if (source === 'request') { requestRaw.aborted = true; requestRaw.emit('close') }
    else replyRaw.emit('close')
    await pending
    expect(deps.syntheses.listByTree(tree.id)[0].status).toBe('cancelled')
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(requestRaw.listenerCount('close')).toBe(0)
    expect(replyRaw.listenerCount('close')).toBe(0)
    expect(replyRaw.end).not.toHaveBeenCalled()
    expect(events(writes.join('')).map((frame) => frame.type)).toEqual(['started'])
  })

  it('validates verdicts and exposes explicit decisions alongside existing merges', async () => {
    const { app, deps, tree, rootNode, child } = setup()
    deps.merges.record({ sourceNodeId: child.id, targetNodeId: rootNode.id, conclusion: 'Decision', landingSegmentId: null })
    for (const verdict of ['adopted', 'rejected', 'superseded', null]) {
      const response = await app.inject({ method: 'PATCH', url: `/api/nodes/${child.id}/verdict`, payload: { verdict } })
      expect(response.statusCode).toBe(200)
      expect(response.json().node.verdict).toBe(verdict)
    }
    for (const payload of [{}, { verdict: 'merged' }, { verdict: 1 }]) expect((await app.inject({ method: 'PATCH', url: `/api/nodes/${child.id}/verdict`, payload })).statusCode).toBe(400)
    await app.inject({ method: 'PATCH', url: `/api/nodes/${child.id}/verdict`, payload: { verdict: 'adopted' } })
    const decisions = (await app.inject({ method: 'GET', url: `/api/trees/${tree.id}/decisions` })).json()
    expect(decisions).toMatchObject({ merges: [{ conclusion: 'Decision' }], nodes: [{ id: child.id, verdict: 'adopted' }] })
    expect((await app.inject({ method: 'PATCH', url: '/api/nodes/missing/verdict', payload: { verdict: null } })).statusCode).toBe(404)
  })

  it('manually extracts and deduplicates questions, preserves resolved status on re-extract, and supports edits and reopen', async () => {
    const { app, deps, tree, child } = setup()
    const calls = vi.fn()
    deps.providerOverride = createMockProvider({ chunks: [JSON.stringify([
      { question: '  Which option? ', nodeId: child.id }, { question: 'Which option?', nodeId: child.id },
      { question: 'Missing source?', nodeId: 'foreign' },
    ])], onMessages: calls })
    const url = `/api/trees/${tree.id}/open-questions/extract`
    const first = (await app.inject({ method: 'POST', url })).json().questions
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({ question: 'Which option?', node_id: child.id, source: 'ai', status: 'open' })
    expect(first[1].node_id).toBeNull()
    const updateUrl = `/api/open-questions/${first[0].id}`
    const resolved = (await app.inject({ method: 'PATCH', url: updateUrl, payload: { status: 'resolved' } })).json().question
    expect(resolved.resolved_at).toEqual(expect.any(String))
    expect((await app.inject({ method: 'POST', url })).json().questions[0]).toEqual(resolved)
    expect(calls).toHaveBeenCalledTimes(2)
    const reopened = (await app.inject({ method: 'PATCH', url: updateUrl, payload: { status: 'open', question: '  Edited question? ' } })).json().question
    expect(reopened).toMatchObject({ status: 'open', resolved_at: null, question: 'Edited question?' })
    expect((await app.inject({ method: 'PATCH', url: updateUrl, payload: { question: 'Missing source?' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PATCH', url: updateUrl, payload: { question: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: `/api/trees/${tree.id}/open-questions` })).json().questions).toHaveLength(2)
  })

  it('returns latest and cached retrospectives and rejects missing trees or invalid configuration before SSE', async () => {
    const { app, deps, tree } = setup()
    const calls = vi.fn()
    deps.providerOverride = createMockProvider({ chunks: ['## 回顾\n下一步'], onMessages: calls })
    const url = `/api/trees/${tree.id}/retrospective`
    expect((await app.inject({ method: 'GET', url })).json().retrospective).toBeNull()
    const first = (await app.inject({ method: 'POST', url })).json()
    expect(first.cached).toBe(false)
    expect((await app.inject({ method: 'POST', url })).json()).toEqual({ ...first, cached: true })
    expect((await app.inject({ method: 'GET', url })).json().retrospective).toEqual(first.retrospective)
    expect(calls).toHaveBeenCalledOnce()
    expect((await app.inject({ method: 'POST', url: '/api/trees/missing/synthesize' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/trees/missing/retrospective' })).statusCode).toBe(404)
    deps.providerOverride = undefined
    deps.settings.set('provider.name', 'invalid')
    const unavailable = await app.inject({ method: 'POST', url: `/api/trees/${tree.id}/synthesize` })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json().code).toBe('PROVIDER_CONFIG')
    expect(deps.syntheses.listByTree(tree.id)).toEqual([])
  })
})
