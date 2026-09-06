import type { MergeRow, NodeRow } from '@vibe/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { CorrectiveMergeButton } from './CorrectiveMergeButton'

function node(content: string): NodeRow {
  return {
    ai_response: null,
    content_schema_version: 2,
    document_content: content,
    created_at: '',
    id: 'parent',
    is_deleted: 0,
    model_override: null,
    parent_id: null,
    sort_order: 0,
    status: 'complete',
    tree_id: 'tree',
    updated_at: '',
    user_input: '父文档',
  }
}

function correctionMerge(direction = '改正'): MergeRow {
  return {
    conclusion: '', created_at: '', direction, id: 'merge-1', kind: 'correction', landing_segment_id: null,
    source_node_id: 'source', target_node_id: 'parent',
  }
}

function openDialog(api: Record<string, unknown>) {
  render(
    <ApiProvider api={api as never}>
      <CorrectiveMergeButton sourceNodeId="source" targetNodeId="parent" />
    </ApiProvider>,
  )
  fireEvent.click(screen.getByTestId('corrective-merge-trigger'))
}

describe('CorrectiveMergeButton', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('requires an instruction and defaults to patch with recursive evidence', () => {
    openDialog({})

    expect(screen.getByTestId('corrective-merge-trigger')).toHaveTextContent('按说明合并到父文档')
    expect(screen.getByRole('heading', { name: '按说明合并到父文档' })).toBeInTheDocument()
    expect(screen.getByTestId('generate')).toHaveTextContent('生成合并草案')
    expect(screen.getByTestId('generate')).toBeDisabled()
    expect(screen.getByTestId('mode-patch')).toBeChecked()
    expect(screen.getByTestId('mode-append')).not.toBeChecked()
    expect(screen.getByTestId('mode-rewrite')).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '包含此分支的递归子树证据' })).toBeChecked()
    expect(screen.getByTestId('instruction-input')).toHaveAccessibleName('合并说明')
    expect(screen.getByTestId('instruction-input').getAttribute('placeholder')).toContain('提炼分支要点补充')
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '纠正结论' } })
    expect(screen.getByTestId('generate')).toBeEnabled()
  })

  it('closes a generated draft without committing or persisting it', async () => {
    const api = {
      commitCorrection: vi.fn(),
      correct: vi.fn(async () => ({
        mode: 'patch' as const,
        pairs: [{ quote: '旧结论', replacement: '新结论' }],
        unmatched: { heading: '纠正附注' as const, strategy: 'append-note' as const },
      })),
      getNode: vi.fn(async () => ({ annotations: [], node: node('旧结论'), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '改正' } })
    fireEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByLabelText('定向补丁草案')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(api.commitCorrection).not.toHaveBeenCalled()
    expect(useWorkbench.getState().treeMerges).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('applies matched patches in the client and commits the final full document', async () => {
    const updated = node('# 标题\n新结论')
    const merge = correctionMerge('改正')
    const api = {
      commitCorrection: vi.fn(async () => ({ merge, node: updated })),
      correct: vi.fn(async () => ({
        mode: 'patch' as const,
        pairs: [{ quote: '旧结论', replacement: '新结论' }],
        unmatched: { heading: '纠正附注' as const, strategy: 'append-note' as const },
      })),
      getNode: vi.fn(async () => ({ annotations: [], node: node('# 标题\n旧结论'), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: ' 改正 ' } })
    fireEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByLabelText('替换对 1')).toHaveTextContent('旧结论')
    fireEvent.click(screen.getByTestId('adopt'))

    await waitFor(() => expect(api.commitCorrection).toHaveBeenCalledWith('source', {
      direction: '改正', documentContent: '# 标题\n新结论',
    }))
    expect(useWorkbench.getState().nodesById.parent).toEqual(updated)
    expect(useWorkbench.getState().treeMerges).toEqual([merge])
    expect(useWorkbench.getState().mergeRefreshTick).toBe(1)
  })

  it('marks unmatched patches and appends them under correction notes', async () => {
    const api = {
      commitCorrection: vi.fn(async (_source: string, body: { documentContent: string }) => ({
        merge: correctionMerge(), node: node(body.documentContent),
      })),
      correct: vi.fn(async () => ({
        mode: 'patch' as const,
        pairs: [{ quote: '不存在的原文', replacement: '需要保留的纠正说明' }],
        unmatched: { heading: '纠正附注' as const, strategy: 'append-note' as const },
      })),
      getNode: vi.fn(async () => ({ annotations: [], node: node('原正文'), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '补充纠正' } })
    fireEvent.click(screen.getByTestId('generate'))

    expect(await screen.findByText(/原文未匹配/)).toHaveTextContent('纠正附注')
    fireEvent.click(screen.getByTestId('adopt'))
    await waitFor(() => expect(api.commitCorrection).toHaveBeenCalledWith('source', {
      direction: '补充纠正',
      documentContent: '原正文\n\n## 纠正附注\n\n需要保留的纠正说明',
    }))
  })

  it('previews and commits an appended section after a closed code block', async () => {
    const base = '原正文\n\n```ts\nconst value = 1\n```'
    const documentContent = `${base}\n\n## 补充建议\n\n先验证，再推广。`
    const api = {
      commitCorrection: vi.fn(async (_source: string, body: { documentContent: string }) => ({
        merge: correctionMerge('提炼分支要点补充'), node: node(body.documentContent),
      })),
      correct: vi.fn(async () => ({
        mode: 'append' as const,
        section: { body: '先验证，再推广。', title: '补充建议' },
      })),
      getNode: vi.fn(async () => ({ annotations: [], node: node(base), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '提炼分支要点补充' } })
    fireEvent.click(screen.getByTestId('mode-append'))
    fireEvent.click(screen.getByTestId('generate'))

    expect(await screen.findByLabelText('追加合并说明草案')).toHaveTextContent('补充建议')
    expect(screen.getByLabelText('追加合并说明草案')).toHaveTextContent('先验证，再推广。')
    expect(screen.getByLabelText('文末追加变化')).toHaveTextContent('## 补充建议')
    expect(api.correct).toHaveBeenCalledWith('source', {
      direction: '提炼分支要点补充', includeSubtree: true, mode: 'append',
    })
    fireEvent.click(screen.getByTestId('adopt'))

    await waitFor(() => expect(api.commitCorrection).toHaveBeenCalledWith('source', {
      direction: '提炼分支要点补充', documentContent,
    }))
  })

  it('offers explicit rewrite mode with its full line diff expanded', async () => {
    const api = {
      commitCorrection: vi.fn(),
      correct: vi.fn(async () => ({ fullText: '第一行\n新第二行', mode: 'rewrite' as const })),
      getNode: vi.fn(async () => ({ annotations: [], node: node('第一行\n旧第二行'), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '整篇统一口径' } })
    fireEvent.click(screen.getByTestId('mode-rewrite'))
    fireEvent.click(screen.getByTestId('generate'))

    const diff = await screen.findByLabelText('整篇重写变化')
    expect(diff).toHaveTextContent('旧第二行')
    expect(diff).toHaveTextContent('新第二行')
    expect(api.correct).toHaveBeenCalledWith('source', {
      direction: '整篇统一口径', includeSubtree: true, mode: 'rewrite',
    })
  })

  it.each([
    {
      cause: new ApiError(503, { code: 'PROVIDER_CONFIG', error: 'Unsupported provider: claude-o50' }),
      expected: 'AI 服务商配置不受支持（仅支持 codex），请在设置中修正',
      scenario: 'provider configuration',
    },
    {
      cause: new Error('network failed'),
      expected: '合并草案生成失败，父文档尚未修改。',
      scenario: 'ordinary draft',
    },
  ])('maps $scenario failures to the intended message', async ({ cause, expected }) => {
    const api = {
      correct: vi.fn(async () => { throw cause }),
      getNode: vi.fn(async () => ({ annotations: [], node: node('原正文'), segments: [] })),
    }
    openDialog(api)
    fireEvent.change(screen.getByTestId('instruction-input'), { target: { value: '提炼要点' } })
    fireEvent.click(screen.getByTestId('generate'))

    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
  })
})
