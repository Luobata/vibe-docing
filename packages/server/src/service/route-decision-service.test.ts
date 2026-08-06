import { describe, expect, it } from 'vitest'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import type { Provider } from '../provider/types'
import { fixedClock } from '../util/clock'
import { createRouteDecisionService } from './route-decision-service'

describe('RouteDecisionService', () => {
  it('uses ContextEngine and an injected provider to classify an optimistic answer', async () => {
    const deps = createDeps({
      clock: fixedClock('2026-08-05T00:00:00.000Z'),
      db: openMemoryDb(),
    })
    const { rootNode, tree } = deps.trees.create('缓存设计')
    deps.nodes.updateContent(rootNode.id, {
      aiResponse: JSON.stringify({
        content: [{ content: [{ text: 'Redis 与内存缓存', type: 'text' }], type: 'paragraph' }],
        type: 'doc',
      }),
      status: 'complete',
    })
    const annotation = deps.annotations.create({
      kind: 'selection',
      nodeId: rootNode.id,
      quotedText: 'Redis',
    })
    const redisBranch = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: 'Redis 深入',
    })
    deps.annotations.linkChild(annotation.id, redisBranch.id)
    const optimisticAnswer = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: 'Redis 持久化怎么配？',
    })
    let prompt = ''
    const provider = createMockProvider({
      chunks: [
        JSON.stringify({
          candidates: [
            {
              label: 'Redis 深入',
              refId: redisBranch.id,
              score: 0.91,
              target: 'bound-subdoc',
            },
            {
              label: '主文档延续',
              refId: null,
              score: 0.45,
              target: 'main-continuation',
            },
          ],
        }),
      ],
      onMessages: (messages) => {
        prompt = messages.map((message) => message.content).join('\n')
      },
    })

    const result = await createRouteDecisionService({
      annotations: deps.annotations,
      context: deps.context,
      nodes: deps.nodes,
      provider,
      settings: deps.settings,
    }).route({ answerNodeId: optimisticAnswer.id })

    expect(result.state).toBe('high-confidence-elsewhere')
    expect(result.chosen?.refId).toBe(redisBranch.id)
    expect(prompt).toContain('Redis 持久化怎么配？')
    expect(prompt).toContain('Redis 深入')
  })

  it('reads adjustable convergence thresholds from settings', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const optimisticAnswer = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: 'q',
    })
    deps.settings.set('routing.highConfidence', '0.6')
    deps.settings.set('routing.leadMargin', '0.1')
    const provider = createMockProvider({
      chunks: [
        JSON.stringify({
          candidates: [
            { label: '新分支', refId: 'anchor', score: 0.61, target: 'new-branch' },
            { label: '主文档', refId: null, score: 0.5, target: 'main-continuation' },
          ],
        }),
      ],
    })

    const result = await createRouteDecisionService({
      annotations: deps.annotations,
      context: deps.context,
      nodes: deps.nodes,
      provider,
      settings: deps.settings,
    }).route({ answerNodeId: optimisticAnswer.id })

    expect(result.state).toBe('high-confidence-elsewhere')
    expect(result.thresholds).toEqual({ highConfidence: 0.6, leadMargin: 0.1 })
  })

  it('returns failed when provider classification fails', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const { rootNode, tree } = deps.trees.create('t')
    const optimisticAnswer = deps.nodes.create({
      parentId: rootNode.id,
      treeId: tree.id,
      userInput: 'q',
    })
    const provider: Provider = {
      async complete() {
        throw new Error('classifier unavailable')
      },
      async *stream() {},
    }

    const result = await createRouteDecisionService({
      annotations: deps.annotations,
      context: deps.context,
      nodes: deps.nodes,
      provider,
      settings: deps.settings,
    }).route({ answerNodeId: optimisticAnswer.id })

    expect(result.state).toBe('failed')
    expect(result.reason).toContain('classifier unavailable')
    expect(result.fallback.target).toBe('main-continuation')
  })
})
