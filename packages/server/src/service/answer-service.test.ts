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
import { fixedClock } from '../util/clock'
import { createAnswerService } from './answer-service'

function setup(settings: { getProjectRoot(): string | null } = { getProjectRoot: () => null }) {
  const db = openMemoryDb()
  const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const { rootNode } = createTreeRepo(db, clock).create('tree')
  const nodes = createNodeRepo(db, clock)
  const segments = createSegmentRepo(db)
  const versions = createVersionRepo(db, clock)
  return {
    nodes,
    rootNode,
    service: createAnswerService({ nodes, segments, settings, versions }),
    versions,
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
    const context = setup({ getProjectRoot: () => dir })

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
    const context = setup({ getProjectRoot: () => null })
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

  it('stops after max tool rounds and finalizes via a single stream fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-answer-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    const context = setup({ getProjectRoot: () => dir })

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
