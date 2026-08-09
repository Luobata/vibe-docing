import type { NodeRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import { prosemirrorToPlainText } from '../context/prosemirror'
import type { Provider } from '../provider/types'
import { createAnswerService } from './answer-service'

describe('AnswerService cancellation', () => {
  it('preserves partial content as cancelled without creating a version', async () => {
    let current: NodeRow = {
      ai_response: null,
      created_at: '',
      id: 'node-1',
      is_deleted: 0,
      model_override: null,
      parent_id: null,
      sort_order: 0,
      status: 'draft',
      tree_id: 'tree-1',
      updated_at: '',
      user_input: null,
    }
    const snapshot = vi.fn()
    const service = createAnswerService({
      nodes: {
        get: () => current,
        updateContent: (_id: string, patch: {
          aiResponse?: string | null
          status?: NodeRow['status']
          userInput?: string | null
        }) => {
          current = {
            ...current,
            ai_response: patch.aiResponse ?? current.ai_response,
            status: patch.status ?? current.status,
            user_input: patch.userInput ?? current.user_input,
          }
          return current
        },
      },
      segments: { listByNode: () => [] },
      settings: { getProjectRoot: () => null },
      versions: { get: () => undefined, snapshot },
    } as never)
    const controller = new AbortController()
    const provider = {
      async complete() {
        return ''
      },
      async *stream(_messages, options) {
        yield '部分'
        options?.signal?.throwIfAborted()
        yield '不应生成'
      },
    } satisfies Provider

    await expect(service.generate({
      nodeId: current.id,
      provider,
      signal: controller.signal,
      userInput: '问题',
    }, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' })

    expect(current.status).toBe('cancelled')
    expect(prosemirrorToPlainText(current.ai_response)).toBe('部分')
    expect(snapshot).not.toHaveBeenCalled()
  })
})
