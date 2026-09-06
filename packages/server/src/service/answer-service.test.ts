import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../context/assemble'
import { prosemirrorToPlainText } from '../context/prosemirror'
import { openMemoryDb } from '../db/connection'
import { createMockProvider } from '../provider/mock-provider'
import type { ToolEvent } from '../provider/types'
import { createNodeRepo } from '../repo/node-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { createTreeRepo } from '../repo/tree-repo'
import { createVersionRepo } from '../repo/version-repo'
import { createVisualArtifactRepo } from '../repo/visual-artifact-repo'
import { fixedClock } from '../util/clock'
import { createAnswerService } from './answer-service'

function setup(settings: { get(key: string): string | undefined; getProjectRoot(): string | null } = { get: () => undefined, getProjectRoot: () => null }) {
  const db = openMemoryDb()
  const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const { rootNode } = createTreeRepo(db, clock).create('tree')
  const nodes = createNodeRepo(db, clock)
  const segments = createSegmentRepo(db)
  const versions = createVersionRepo(db, clock)
  const visualArtifacts = createVisualArtifactRepo(db, clock)
  return {
    nodes,
    rootNode,
    service: createAnswerService({ nodes, segments, settings, versions, visualArtifacts }),
    versions,
    visualArtifacts,
  }
}

describe('AnswerService', () => {
  it('persists every stream increment, completes, and increments version_no', async () => {
    const context = setup()
    const observed: Array<{ status: string; text: string }> = []

    const first = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['缓存', '有多种'] }),
        userInput: '讲缓存',
      },
      () => {
        const current = context.nodes.get(context.rootNode.id)!
        observed.push({
          status: current.status,
          text: prosemirrorToPlainText(current.ai_response),
        })
      },
    )

    expect(observed).toEqual([
      { status: 'streaming', text: '缓存' },
      { status: 'streaming', text: '缓存有多种' },
    ])
    expect(first.status).toBe('complete')
    expect(prosemirrorToPlainText(first.ai_response)).toBe('缓存有多种')

    await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['第二版'] }),
        userInput: '重新生成',
      },
      () => {},
    )
    const versions = context.versions.listByNode(context.rootNode.id)
    expect(versions.map((version) => version.version_no)).toEqual([1, 2])
    expect(versions.map((version) => version.change_kind)).toEqual([
      'regenerate',
      'regenerate',
    ])
  })

  it('preserves partial content, marks error, snapshots, and rethrows', async () => {
    const context = setup()
    await expect(
      context.service.generate(
        {
          nodeId: context.rootNode.id,
          provider: createMockProvider({ chunks: ['部分', '丢失'], failAfter: 1 }),
          userInput: '问题',
        },
        () => {},
      ),
    ).rejects.toThrow('mock stream failure')

    const node = context.nodes.get(context.rootNode.id)!
    expect(node.status).toBe('error')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('部分')
    expect(context.versions.listByNode(node.id)).toHaveLength(1)
  })

  it('with a project root, runs a tool round then finalizes with only the final answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-answer-'))
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture-project"}')
    // 关闭自动标签，避免标签生成的 provider 调用混入本测试的消息捕获。
    const context = setup({
      get: (key: string) => (key === 'tags.autoGenerate' ? 'false' : undefined),
      getProjectRoot: () => dir,
    })

    const captured: ChatMessage[][] = []
    const provider = createMockProvider({
      onMessages: (messages) => captured.push(messages.map((m) => ({ ...m }))),
      toolScript: [
        [
          {
            type: 'tool_call',
            id: 'c1',
            name: 'read_file',
            arguments: '{"path":"package.json"}',
          },
        ],
        [{ type: 'text', text: '最终答复' }],
      ],
    })

    const chunks: string[] = []
    const node = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider,
        userInput: '看下 package.json',
      },
      (chunk) => chunks.push(chunk),
    )

    // 正文只包含最终答复，不含工具往返的中间文本。
    expect(node.status).toBe('complete')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('最终答复')
    expect(chunks.join('')).toBe('最终答复')

    // dispatchTool 以该 root 执行：第 2 轮 messages 应含 role:'tool' 且带文件内容。
    expect(captured.length).toBe(2)
    const round2 = captured[1]
    const toolMessage = round2.find((m) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    expect(toolMessage?.tool_call_id).toBe('c1')
    expect(toolMessage?.content).toContain('fixture-project')
    // 中间轮的 assistant tool_calls 也应被追加。
    const assistantWithTools = round2.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls),
    )
    expect(assistantWithTools?.tool_calls?.[0]?.function.name).toBe('read_file')
  })

  it('without a project root, uses the single-shot stream path', async () => {
    const context = setup({ get: () => undefined, getProjectRoot: () => null })
    const chunks: string[] = []
    const node = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['单轮', '回复'] }),
        userInput: '没有根目录',
      },
      (chunk) => chunks.push(chunk),
    )
    expect(node.status).toBe('complete')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('单轮回复')
    expect(chunks).toEqual(['单轮', '回复'])
  })

  it('accepts a proactive visual tool call, streams lifecycle events, and persists a reloadable reference', async () => {
    const context = setup()
    const args = {
      kind: 'architecture', title: '分层架构', altText: '模型、存储、渲染三层架构', renderer: 'canvas',
      nodes: [{ id: 'model', label: '模型' }, { id: 'store', label: '存储' }, { id: 'render', label: '渲染' }],
      edges: [{ id: 'e1', source: 'model', target: 'store' }, { id: 'e2', source: 'store', target: 'render' }],
      groups: [],
    }
    const provider = createMockProvider({
      toolScript: [
        [{ type: 'tool_call', id: 'visual-call', name: 'create_visual', arguments: JSON.stringify(args) }],
        [{ type: 'text', text: '正文说明' }],
      ],
    })
    const events: import('@vibe/shared').VisualStreamEvent[] = []
    const node = await context.service.generate(
      { nodeId: context.rootNode.id, provider, userInput: '解释整体架构' },
      () => {},
      (event) => events.push(event),
    )

    expect(events.map((event) => event.type)).toEqual(['visual_placeholder', 'visual_ready'])
    const ready = events[1]
    expect(ready.type).toBe('visual_ready')
    if (ready.type !== 'visual_ready') throw new Error('visual_ready event expected')
    expect(context.visualArtifacts.get(ready.artifactId, ready.revision)).toEqual(ready.artifact)
    expect(JSON.parse(node.ai_response!).content).toContainEqual({
      type: 'visual_ref',
      attrs: { artifactId: ready.artifactId, revision: ready.revision, altText: args.altText },
    })
    expect(prosemirrorToPlainText(node.ai_response)).toBe(`正文说明\n${args.altText}\n`)
  })

  it('stops after max tool rounds and finalizes via a single stream fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-answer-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    const context = setup({ get: () => undefined, getProjectRoot: () => dir })

    // 每一轮都返回 tool_call，永不收尾，触发 maxRounds 兜底。
    const toolScript: ToolEvent[][] = Array.from({ length: 12 }, (_, index) => [
      { type: 'tool_call', id: `c${index}`, name: 'list_dir', arguments: '{}' },
    ])
    const provider = createMockProvider({ chunks: ['兜底回复'], toolScript })

    const node = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider,
        userInput: '一直调用工具',
      },
      () => {},
    )
    expect(node.status).toBe('complete')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('兜底回复')
  })
})

describe('auto tag generation', () => {
  it('generates tags from provider.complete after the answer completes', async () => {
    const context = setup()
    const node = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['["缓存设计", "Redis", "布隆过滤器"]'] }),
        userInput: '讲缓存设计的取舍',
      },
      () => {},
    )
    expect(node.status).toBe('complete')
    // autoTagNode 是 fire-and-forget，等一个宏任务让 Promise 落定。
    await new Promise((resolve) => setTimeout(resolve, 20))
    const stored = context.nodes.get(node.id)?.tags_json
    expect(JSON.parse(stored ?? '[]')).toEqual(['缓存设计', 'Redis', '布隆过滤器'])
  })

  it('skips generation when tags.autoGenerate is disabled', async () => {
    const context = setup({ get: (key: string) => (key === 'tags.autoGenerate' ? 'false' : undefined), getProjectRoot: () => null })
    const node = await context.service.generate(
      {
        nodeId: context.rootNode.id,
        provider: createMockProvider({ chunks: ['["不会被采用的标签"]'] }),
        userInput: '讲缓存设计的取舍',
      },
      () => {},
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(context.nodes.get(node.id)?.tags_json ?? null).toBeNull()
  })
})
