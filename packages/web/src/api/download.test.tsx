import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as shared from '@vibe/shared'
import type { NodeRow } from '@vibe/shared'
import { createApi } from './client'
import { ApiProvider } from './context'
import type { Synthesis } from './types'
import { SynthesisPanel } from '../components/SynthesisPanel'
import { Workbench } from '../components/Workbench'
import { generationTaskKeys, generationTaskRegistry, useWorkbench } from '../state/workbench-store'
import * as downloads from './download'
import { downloadMarkdown, downloadNodeMarkdown, markdownFilename } from './download'

vi.mock('../components/MainDoc', () => ({ MainDoc: () => null }))

const createObjectURL = vi.fn((_blob: Blob) => 'blob:markdown-download')
const revokeObjectURL = vi.fn()
const node: NodeRow = { id: 'root', tree_id: 'tree', parent_id: null, user_input: 'Node title', document_content: '# Body', content_schema_version: 2,
  ai_response: null, status: 'complete', is_deleted: 0, sort_order: 0, model_override: null, created_at: '', updated_at: '' }
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}
beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  useWorkbench.getState().reset()
  useWorkbench.getState().loadTree({ treeId: 'tree', treeTitle: 'Tree title', rootNodeId: 'root', nodes: [node] })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Markdown downloads', () => {
  it.each([
    ['a/b\\c"d\r\ne', 'a_b_c_d__e.md'],
    ['标题'.repeat(60), '标题'.repeat(50) + '.md'],
    ['', 'document.md'],
  ])('cleans and bounds the filename for %j', (title, expected) => {
    expect(markdownFilename(title)).toBe(expected)
  })

  it('clicks a temporary download link with an exact UTF-8 Markdown Blob and revokes its URL after dispatch', async () => {
    const content = '# 标题\n\n```text\n┌─┐\n└─┘\n```\n\n| A | B |\n|---|---|\n| 一 | 二 |\n\n证据 [^1]\n[^1]: 来源'
    let clicked: HTMLAnchorElement | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked = this })
    vi.useFakeTimers()
    downloadMarkdown(content, 'Export/name')
    expect(clicked?.download).toBe('Export_name.md')
    expect(clicked?.href).toBe('blob:markdown-download')
    expect(clicked?.isConnected).toBe(false)
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown-download')
    vi.useRealTimers()
    const text = await readBlob(blob)
    expect(text).toBe(content)
  })

  it('reads canonical content through the shared chain once and preserves PM headings and bold without mutating the node', async () => {
    const source = JSON.stringify({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] },
    ] })
    const input = { ...node, document_content: source, content_schema_version: 1 }
    const before = JSON.stringify(input)
    const documentContentOf = vi.spyOn(shared, 'documentContentOf')
    const legacyDocumentToMarkdown = vi.spyOn(shared, 'legacyDocumentToMarkdown')
    const normalizeMarkdown = vi.spyOn(shared, 'normalizeMarkdown')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadNodeMarkdown(input, 'Tree fallback')
    expect(documentContentOf.mock.calls).toEqual([[input]])
    expect(legacyDocumentToMarkdown.mock.calls).toEqual([[source, 1]])
    expect(normalizeMarkdown.mock.calls).toEqual([['## Heading\n\n**Bold**']])
    expect(await readBlob(createObjectURL.mock.calls[0][0])).toBe('## Heading\n\n**Bold**')
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([['Tree/fallback', 'Tree_fallback.md'], ['', 'document.md']])('falls back from an empty node title to %j', (treeTitle, filename) => {
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download })
    vi.useFakeTimers()
    downloadNodeMarkdown({ ...node, user_input: null }, treeTitle)
    expect(name).toBe(filename)
    vi.runOnlyPendingTimers()
  })
})

describe('download buttons', () => {
  const workbenchApi = () => ({ ...createApi(), getNode: () => new Promise<never>(() => {}), listTrees: () => new Promise<never>(() => {}), listFolders: () => new Promise<never>(() => {}) })
  const synthesis = (status: Synthesis['status'] = 'done'): Synthesis => ({ id: 's1', treeId: 'tree', status,
    contentMd: '# Tree title\n\n' + ['背景', '核心分歧', '决策与理由', '被否决方案及原因', '风险', '开放问题'].map((title) => `## ${title}\n\n证据 [^1]`).join('\n\n') + '\n\n[^1]: root · Node title',
    sections: [], footnotes: [{ number: 1, nodeId: 'root', title: 'Node title', path: ['Node title'] }], nodeResults: {}, inputDigest: 'digest', error: null,
    createdAt: '2026-09-14T00:00:00Z', updatedAt: '', finishedAt: null })
  async function renderSynthesis(item: Synthesis) {
    const api = { ...createApi(), listSyntheses: vi.fn(async () => ({ syntheses: [item] })),
      listOpenQuestions: vi.fn(async () => ({ questions: [] })), getRetrospective: vi.fn(async () => ({ retrospective: null })),
      listDecisions: vi.fn(async () => ({ merges: [], nodes: [] })), getSynthesisShare: vi.fn(async () => ({ share: null })),
      getSynthesis: vi.fn(), createSynthesisShare: vi.fn(),
    }
    render(<ApiProvider api={api}><SynthesisPanel node={node} /></ApiProvider>)
    fireEvent.click(screen.getByRole('button', { name: '成文与讨论经营' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
    return api
  }

  it('downloads the current main node through the helper beside SharePanel', () => {
    const download = vi.spyOn(downloads, 'downloadNodeMarkdown').mockImplementation(() => {})
    render(<ApiProvider api={workbenchApi()}><Workbench /></ApiProvider>)
    const button = screen.getByRole('button', { name: '下载 .md' })
    expect(button).toHaveClass('quiet-button')
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(download).toHaveBeenCalledWith(node, 'Tree title')
    expect(useWorkbench.getState().nodesById.root).toEqual(node)
  })

  it('disables main download for streaming node state or a streaming generation task', () => {
    const download = vi.spyOn(downloads, 'downloadNodeMarkdown').mockImplementation(() => {})
    act(() => useWorkbench.getState().upsertNode({ ...node, status: 'streaming' }))
    render(<ApiProvider api={workbenchApi()}><Workbench /></ApiProvider>)
    const button = screen.getByRole('button', { name: '下载 .md' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(download).not.toHaveBeenCalled()
    act(() => useWorkbench.getState().upsertNode(node))
    expect(button).toBeEnabled()
    act(() => { generationTaskRegistry.start({ key: generationTaskKeys.forkExpand('root', 0, 4), kind: 'fork-expand', ownerMainNodeId: 'root', targetNodeId: 'root' }) })
    expect(button).toBeDisabled()
  })

  it('keeps the main download button disabled when no document is selected', () => {
    useWorkbench.getState().reset()
    render(<ApiProvider api={workbenchApi()}><Workbench /></ApiProvider>)
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeDisabled()
  })

  it('keeps one operable synthesis panel after repeatedly switching the main node', async () => {
    const { MainDoc } = await vi.importActual<typeof import('../components/MainDoc')>('../components/MainDoc')
    const child = { ...node, id: 'child', parent_id: node.id, user_input: 'Child title' }
    useWorkbench.getState().loadTree({ treeId: 'tree', rootNodeId: node.id, nodes: [node, child] })
    const api = { ...createApi(),
      getNode: vi.fn(async (id: string) => ({ node: id === child.id ? child : node, annotations: [], segments: [] })),
      listDiscussion: vi.fn(async () => ({ messages: [] })),
      listSyntheses: vi.fn(async () => ({ syntheses: [] })),
      listOpenQuestions: vi.fn(async () => ({ questions: [] })),
      getRetrospective: vi.fn(async () => ({ retrospective: null })),
      listDecisions: vi.fn(async () => ({ merges: [], nodes: [] })),
    }
    const { container } = render(<ApiProvider api={api}><MainDoc /></ApiProvider>)
    for (const id of [child.id, node.id, child.id, node.id]) {
      await act(async () => { useWorkbench.getState().setMain(id) })
      expect(container.querySelectorAll('.synthesis-panel')).toHaveLength(1)
      expect(container.querySelectorAll('.material-panel')).toHaveLength(1)
    }
    const toggle = screen.getByRole('button', { name: '成文与讨论经营' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('downloads the selected synthesis content verbatim, including six chapters and native footnote definitions, without creating a share', async () => {
    const download = vi.spyOn(downloads, 'downloadMarkdown').mockImplementation(() => {})
    const item = synthesis()
    const api = await renderSynthesis(item)
    const button = screen.getByRole('button', { name: '下载 .md' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(download).toHaveBeenCalledWith(item.contentMd, 'Tree title · 成文')
    expect(download.mock.calls[0][0]).toContain('\n[^1]: root · Node title')
    expect(api.getSynthesis).not.toHaveBeenCalled()
    expect(api.createSynthesisShare).not.toHaveBeenCalled()
  })

  it.each(['queued', 'running'] as const)('disables synthesis download while its selected record is %s', async (status) => {
    const download = vi.spyOn(downloads, 'downloadMarkdown').mockImplementation(() => {})
    await renderSynthesis(synthesis(status))
    const button = screen.getByRole('button', { name: '下载 .md' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(download).not.toHaveBeenCalled()
  })
})
