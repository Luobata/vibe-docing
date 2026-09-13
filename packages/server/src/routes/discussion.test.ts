import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp, type DecoratedApp } from '../app'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { createMockProvider } from '../provider/mock-provider'
import type { AppReply, RouteHandler } from '../http/app-instance'
import { DISCUSSION_MOVES } from '../service/discussion-service'
import { registerDiscussionRoutes } from './discussion'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-discussion-route-'))
  const deps = createDeps({ db: openMemoryDb(), env: {}, vaultPath: root })
  deps.settings.set('vault.path', root)
  const node = deps.trees.create('Note').rootNode
  const main = deps.vault.ensureNodeFile(node)
  deps.providerOverride = createMockProvider({ chunks: ['first', ' second'] })
  const app = buildApp(deps)
  cleanups.push(async () => { await app.close(); deps.db.close(); rmSync(root, { recursive: true, force: true }) })
  return { app, deps, main }
}

function events(body: string): Array<Record<string, any>> {
  return body.trim().split('\n\n').filter(Boolean).map((frame) => JSON.parse(frame.slice(6)))
}

describe('discussion routes', () => {
  it.each(['request', 'reply'] as const)('aborts the provider and removes close listeners when the %s disconnects', async (source) => {
    const { deps, main } = setup()
    let observedSignal: AbortSignal | undefined
    deps.providerOverride = { complete: async () => '', async *stream(_messages, options) {
      observedSignal = options?.signal
      yield 'partial'
      await new Promise<void>(() => {})
    } }
    const handlers = new Map<string, RouteHandler>()
    registerDiscussionRoutes({ deps, get() {}, post(path: string, handler: RouteHandler) { handlers.set(path, handler) } } as unknown as DecoratedApp)
    const requestRaw = Object.assign(new EventEmitter(), { aborted: false, socket: { destroyed: false } })
    let received!: () => void
    const firstChunk = new Promise<void>((resolve) => { received = resolve })
    const writes: string[] = []
    const replyRaw = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false, end: vi.fn(), writeHead: vi.fn(),
      write(chunk: string) { writes.push(chunk); received(); return true },
    })
    const reply = { hijack: vi.fn(), raw: replyRaw } as unknown as AppReply
    const pending = handlers.get('/api/nodes/:id/discussion')!({ method: 'POST', url: '', params: { id: main.id }, body: { userInput: 'Question' }, raw: requestRaw }, reply)
    await firstChunk
    replyRaw.destroyed = true
    if (source === 'request') { requestRaw.aborted = true; requestRaw.emit('close') }
    else replyRaw.emit('close')
    await pending
    expect(observedSignal?.aborted).toBe(true)
    expect(events(writes.join(''))).toEqual([{ type: 'chunk', text: 'partial' }])
    expect(deps.discussionMessages.listByNode(main.id)).toMatchObject([{ role: 'user', content: 'Question' }])
    expect(requestRaw.listenerCount('close')).toBe(0)
    expect(replyRaw.listenerCount('close')).toBe(0)
    expect(replyRaw.end).not.toHaveBeenCalled()
  })

  it('keeps streaming text and pings for longer than 45 seconds', async () => {
    const { app, deps, main } = setup()
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    deps.providerOverride = { complete: async () => '', async *stream() {
      started()
      yield 'first'
      await new Promise((resolve) => setTimeout(resolve, 40_000))
      yield ' second'
      await new Promise((resolve) => setTimeout(resolve, 40_000))
      yield ' third'
    } }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pending = Promise.resolve(app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion`, payload: { userInput: 'Question' } }))
    await providerStarted
    await vi.advanceTimersByTimeAsync(80_000)
    const frames = events((await pending).body)
    expect(frames.filter((frame) => frame.type === 'chunk').map((frame) => frame.text).join('')).toBe('first second third')
    expect(frames.at(-1)?.type).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists the user before generation, streams text, and completes without creating a node', async () => {
    const { app, deps, main } = setup()
    const withTools = vi.fn()
    deps.providerOverride = {
      complete: async () => '',
      streamWithTools: withTools,
      async *stream() {
        expect(deps.discussionMessages.listByNode(main.id)).toMatchObject([{ role: 'user', content: 'Question' }])
        yield 'first'
        yield ' second'
      },
    }
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion`, payload: { userInput: 'Question' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    const frames = events(response.body)
    expect(frames.map((frame) => frame.type)).toEqual(['chunk', 'chunk', 'done'])
    expect(frames[2].messages).toMatchObject([{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'first second' }])
    const loaded = await app.inject({ method: 'GET', url: `/api/nodes/${main.id}/discussion` })
    expect(loaded.json().messages).toEqual(frames[2].messages)
    expect(deps.db.prepare('SELECT COUNT(*) AS count FROM nodes').get()).toEqual({ count: 1 })
    expect(deps.nodes.get(main.id)).toEqual(main)
    expect(withTools).not.toHaveBeenCalled()
  })

  it.each(['challenge', 'converge'] as const)('streams the configured %s move with one call', async (move) => {
    const { app, deps, main } = setup()
    const called = vi.fn()
    deps.providerOverride = createMockProvider({ chunks: ['analysis'], onMessages: called })
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/moves`, payload: { move } })
    const frames = events(response.body)
    expect(called).toHaveBeenCalledOnce()
    expect(called.mock.calls[0][0].at(-1).content).toBe(DISCUSSION_MOVES[move].steps[0].instruction)
    expect(frames[0]).toMatchObject({ type: 'chunk', step: 1, persona: DISCUSSION_MOVES[move].steps[0].label })
    expect(frames.at(-1)?.type).toBe('done')
    expect(deps.discussionMessages.listByNode(main.id)).toHaveLength(2)
  })

  it('runs all three personas serially and includes prior completed perspectives', async () => {
    const { app, deps, main } = setup()
    const called = vi.fn()
    deps.providerOverride = createMockProvider({ chunks: ['position'], onMessages: called })
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/moves`, payload: { move: 'perspectives' } })
    const frames = events(response.body)
    expect(called).toHaveBeenCalledTimes(3)
    expect(frames.filter((frame) => frame.type === 'chunk').map((frame) => frame.persona)).toEqual(['架构师', '保守派', '用户代言人'])
    expect(called.mock.calls[1][0]).toContainEqual({ role: 'assistant', content: '### 架构师\n\nposition' })
    expect(frames.at(-1)?.messages).toHaveLength(4)
  })

  it('retains the first perspective when the second fails and names the failed step', async () => {
    const { app, deps, main } = setup()
    let calls = 0
    deps.providerOverride = {
      complete: async () => '',
      async *stream() {
        calls += 1
        if (calls === 2) { yield 'partial second'; throw new Error('provider failed') }
        yield 'first perspective'
      },
    }
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/moves`, payload: { move: 'perspectives' } })
    const frames = events(response.body)
    expect(frames.at(-1)).toMatchObject({ type: 'error', step: 2, persona: '保守派', message: 'provider failed' })
    expect(frames.filter((frame) => frame.type === 'chunk').map((frame) => frame.text).join('')).toContain('first perspective')
    expect(frames.at(-1)?.messages).toMatchObject([{ role: 'user' }, { role: 'assistant', content: '### 架构师\n\nfirst perspective' }])
    expect(deps.discussionMessages.listByNode(main.id)).toHaveLength(2)
    expect(calls).toBe(2)
  })

  it.each(['complete', 'error'] as const)('emits pings during silence and removes all timers on %s', async (outcome) => {
    const { app, deps, main } = setup()
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    deps.providerOverride = { complete: async () => '', async *stream() {
      started()
      await waiting
      if (outcome === 'error') throw new Error('failed')
      yield 'done thinking'
    } }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pending = Promise.resolve(app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion`, payload: { userInput: 'Question' } }))
    try {
      await providerStarted
      await vi.advanceTimersByTimeAsync(20_000)
      release()
      const frames = events((await pending).body)
      expect(frames.map((frame) => frame.type)).toEqual(outcome === 'complete' ? ['ping', 'ping', 'chunk', 'done'] : ['ping', 'ping', 'error'])
      expect(vi.getTimerCount()).toBe(0)
    } finally { release(); await pending; vi.useRealTimers() }
  })

  it('allows a silent second persona to think for 60 seconds while route pings continue', async () => {
    const { app, deps, main } = setup()
    const signals: AbortSignal[] = []
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let secondStarted!: () => void
    const second = new Promise<void>((resolve) => { secondStarted = resolve })
    deps.providerOverride = { complete: async () => '', async *stream(_messages, options) {
      signals.push(options!.signal!)
      if (signals.length === 1) { yield 'first'; return }
      if (signals.length === 2) { secondStarted(); await waiting; yield 'second'; return }
      yield 'third'
    } }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pending = Promise.resolve(app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/moves`, payload: { move: 'perspectives' } }))
    try {
      await second
      await vi.advanceTimersByTimeAsync(60_000)
      expect(signals).toHaveLength(2)
      expect(signals[1].aborted).toBe(false)
      expect(deps.discussionMessages.listByNode(main.id)).toHaveLength(2)
      release()
      const frames = events((await pending).body)
      expect(frames.filter((frame) => frame.type === 'ping')).toHaveLength(6)
      expect(frames.filter((frame) => frame.type === 'chunk').map((frame) => frame.step)).toEqual([1, 2, 3])
      expect(frames.at(-1)).toMatchObject({ type: 'done', messages: [
        { role: 'user' }, { content: '### 架构师\n\nfirst' },
        { content: '\n\n### 保守派\n\nsecond' }, { content: '\n\n### 用户代言人\n\nthird' },
      ] })
      expect(new Set(signals).size).toBe(3)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { release(); await pending; vi.useRealTimers() }
  })

  it.each(['write throws', 'destroyed without close'] as const)('times out the second persona 45 seconds after route activity stops: %s', async (failure) => {
    const { deps, main } = setup()
    const signals: AbortSignal[] = []
    let secondStarted!: () => void
    const second = new Promise<void>((resolve) => { secondStarted = resolve })
    deps.providerOverride = { complete: async () => '', async *stream(_messages, options) {
      signals.push(options!.signal!)
      if (signals.length === 1) { yield 'first'; return }
      secondStarted()
      await new Promise<void>(() => {}) // The watchdog must finish even if abort is ignored.
    } }
    const discuss = vi.spyOn(deps.discussion, 'discuss')
    const handlers = new Map<string, RouteHandler>()
    registerDiscussionRoutes({ deps, get() {}, post(path: string, handler: RouteHandler) { handlers.set(path, handler) } } as unknown as DecoratedApp)
    const requestRaw = Object.assign(new EventEmitter(), { aborted: false, socket: { destroyed: false } })
    const writes: string[] = []
    let writeFails = false
    const replyRaw = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false, end: vi.fn(), writeHead: vi.fn(),
      write(chunk: string) {
        if (writeFails) throw new Error('transport cannot write')
        writes.push(chunk)
        return false // Buffered writes still count as activity.
      },
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pending = Promise.resolve(handlers.get('/api/nodes/:id/discussion/moves')!({ method: 'POST', url: '', params: { id: main.id }, body: { move: 'perspectives' }, raw: requestRaw }, { hijack: vi.fn(), raw: replyRaw } as unknown as AppReply))
    try {
      await second
      await vi.advanceTimersByTimeAsync(20_000)
      if (failure === 'write throws') writeFails = true
      else replyRaw.destroyed = true
      await vi.advanceTimersByTimeAsync(44_999)
      expect(signals[1].aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await pending
      await expect(discuss.mock.results[0].value).rejects.toMatchObject({
        statusCode: 502, message: '讨论连接超过 45 秒无法写入，请重试',
        details: { move: 'perspectives', step: 2, persona: '保守派' },
      })
      expect(events(writes.join(''))).toEqual([
        { type: 'chunk', text: '### 架构师\n\nfirst', step: 1, persona: '架构师' },
        { type: 'ping' }, { type: 'ping' },
      ])
      expect(deps.discussionMessages.listByNode(main.id)).toMatchObject([
        { role: 'user' }, { role: 'assistant', content: '### 架构师\n\nfirst' },
      ])
      expect(signals).toHaveLength(2)
      expect(signals[0]).not.toBe(signals[1])
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(requestRaw.listenerCount('close')).toBe(0)
      expect(replyRaw.listenerCount('close')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { requestRaw.aborted = true; requestRaw.emit('close'); await pending; vi.useRealTimers() }
  })

  it.each(['child', 'section'] as const)('promotes via the %s endpoint and returns messages and the saved revision', async (mode) => {
    const { app, deps, main } = setup()
    const message = deps.discussionMessages.append({ nodeId: main.id, role: 'assistant', content: 'A conclusion' })
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/promote`, payload: { mode, messageIds: [message.id], baseRevision: main.content_revision } })
    expect(response.statusCode).toBe(200)
    const result = response.json()
    expect(result.content.revision).toBe(result.node.content_revision)
    expect(result.messages[0]).toMatchObject({ promoted_node_id: result.node.id, promoted_mode: mode })
    expect(readFileSync(join(result.node.vault_root, result.node.file_path), 'utf8')).toBe('first second')
    expect(deps.versions.listByNode(result.node.id)).toHaveLength(1)
    if (mode === 'child') expect(result.node.parent_id).toBe(main.id)
    else expect(result.node.id).toBe(main.id)
  })

  it('returns 409 and currentRevision for an outdated section promotion', async () => {
    const { app, deps, main } = setup()
    const message = deps.discussionMessages.append({ nodeId: main.id, role: 'user', content: 'Conclusion' })
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion/promote`, payload: { mode: 'section', messageIds: [message.id], baseRevision: 0 } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'content conflict', currentRevision: main.content_revision })
    expect(deps.versions.listByNode(main.id)).toHaveLength(0)
    expect(deps.discussionMessages.listByNode(main.id)[0].promoted_mode).toBeNull()
  })

  it('validates requests and handles missing nodes and provider configuration before SSE', async () => {
    const { app, deps, main } = setup()
    for (const [suffix, payload] of [['', { userInput: '' }], ['/moves', { move: 'toString' }], ['/promote', { mode: 'correction', messageIds: [] }]] as const) {
      expect((await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion${suffix}`, payload })).statusCode).toBe(400)
    }
    expect((await app.inject({ method: 'GET', url: '/api/nodes/missing/discussion' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/nodes/missing/discussion', payload: { userInput: 'q' } })).statusCode).toBe(404)
    deps.providerOverride = undefined
    deps.settings.set('provider.name', 'invalid')
    const response = await app.inject({ method: 'POST', url: `/api/nodes/${main.id}/discussion`, payload: { userInput: 'q' } })
    expect(response.statusCode).toBe(503)
    expect(response.json().code).toBe('PROVIDER_CONFIG')
    expect(deps.discussionMessages.listByNode(main.id)).toEqual([])
  })
})
