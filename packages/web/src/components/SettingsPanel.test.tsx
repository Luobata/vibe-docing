import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { createApi, type ProviderSettingsView, type ProviderTestResult } from '../api/client'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  it('chooses the local notebook folder with the native picker', async () => {
    const pickDirectory = vi.fn(async () => ({ path: '/Users/me/Notes' }))
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: null, provider: 'openai', vaultPath: null,
      })),
      pickDirectory,
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)

    const input = await screen.findByLabelText('Obsidian Vault 文件夹')
    fireEvent.click(screen.getAllByRole('button', { name: '浏览…' })[0])
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith('vault'))
    expect(input).toHaveValue('/Users/me/Notes')
  })

  it('offers two compatible providers and repairs an unsupported loaded value on save', async () => {
    const updateSettings = vi.fn(async () => ({
      baseUrl: null,
      hasApiKey: false,
      model: 'alwaysday1_max',
      projectRoot: null,
      provider: 'codex',
      vaultPath: '/vault',
    }))
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null,
        hasApiKey: false,
        model: 'alwaysday1_max',
        projectRoot: null,
        provider: 'claude-o50',
        vaultPath: '/vault',
      })),
      updateSettings,
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)

    const select = await screen.findByLabelText('AI 服务商') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((option) => option.value)).toEqual(['codex', 'anthropic'])
    expect([...select.options].map((option) => option.text)).toEqual(['OpenAI 兼容 (codex)', 'Anthropic 兼容 (anthropic)'])
    expect(select).toHaveValue('codex')
    expect(screen.getByText('当前服务商 "claude-o50" 不受支持，保存后将使用 codex')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex' }),
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(screen.queryByText(/当前服务商/)).not.toBeInTheDocument())
  })

  it('prefills settings, prevents duplicate saves, and shows saving and success feedback', async () => {
    let finishSave: ((settings: {
      baseUrl: string | null
      hasApiKey: boolean
      model: string
      projectRoot: string | null
      provider: string
    }) => void) | undefined
    const updateSettings = vi.fn(() => new Promise((resolve) => {
      finishSave = resolve
    }))
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: '/root', provider: 'openai',
      })),
      updateSettings,
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)

    const input = (await screen.findByLabelText('项目代码目录')) as HTMLInputElement
    expect(input.value).toBe('/root')

    fireEvent.change(input, { target: { value: '/proj' } })
    const saveButton = screen.getByRole('button', { name: '保存设置' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: '/proj' }),
        expect.any(AbortSignal),
      ),
    )
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在保存设置…')

    await act(async () => {
      finishSave?.({
        baseUrl: null,
        hasApiKey: false,
        model: 'alwaysday1_max',
        projectRoot: '/proj',
        provider: 'codex',
      })
    })

    expect(await screen.findByRole('status')).toHaveTextContent('设置已保存。')
    expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
    expect(screen.getByLabelText('模型名称')).toHaveValue('alwaysday1_max')
  })

  it('recovers the form and explains when saving times out', async () => {
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null,
        hasApiKey: false,
        model: 'alwaysday1_max',
        projectRoot: '/root',
        provider: 'codex',
      })),
      updateSettings: vi.fn(() => new Promise(() => {})),
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await screen.findByLabelText('模型名称')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('保存超时')
      expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
      expect(screen.getByLabelText('模型名称')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SettingsPanel provider configuration', () => {
  const defaults: ProviderSettingsView = {
    baseUrl: null, model: 'alwaysday1_max', provider: 'codex', hasApiKey: false, projectRoot: null,
    sources: { apiKey: 'unset', baseUrl: 'default', model: 'default' }, sourceVars: {},
  }
  const envSettings: ProviderSettingsView = {
    ...defaults, baseUrl: 'https://env.example/v1', model: 'env-model', hasApiKey: true,
    sources: { apiKey: 'env', baseUrl: 'env', model: 'env' },
    sourceVars: { apiKey: 'VIBE_LLM_API_KEY', baseUrl: 'VIBE_LLM_BASE_URL', model: 'VIBE_LLM_MODEL' },
  }
  async function openAdvanced() {
    await screen.findByLabelText('模型名称')
    fireEvent.click(screen.getByText('AI 与项目设置（高级）'))
  }

  it('saves an Anthropic selection before testing and refreshes alias values and badges', async () => {
    const anthropic: ProviderSettingsView = {
      ...envSettings, provider: 'anthropic', baseUrl: 'https://alias.example/anthropic', model: 'alias-model',
      sourceVars: { apiKey: 'ANTHROPIC_AUTH_TOKEN', baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
    }
    const updateSettings = vi.fn(async (_patch: Record<string, unknown>) => anthropic)
    const testProvider = vi.fn(async () => ({ ok: true, model: 'alias-model', latencyMs: 8 }))
    const api = { getSettings: vi.fn(async () => defaults), updateSettings, testProvider }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.change(screen.getByLabelText('AI 服务商'), { target: { value: 'anthropic' } })
    expect(screen.getByLabelText('AI 服务商')).toHaveValue('anthropic')
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
    expect(screen.getByText('保存服务商后将刷新配置来源，再测试连接。')).toBeInTheDocument()
    expect(screen.getByText('切换服务商会清空已保存的服务地址/模型/密钥，环境变量不受影响')).toBeInTheDocument()
    expect(screen.queryByText(/不受支持/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存。')
    expect(updateSettings.mock.calls[0][0]).toEqual({ provider: 'anthropic', projectRoot: '', vaultPath: '' })
    expect(screen.queryByText('切换服务商会清空已保存的服务地址/模型/密钥，环境变量不受影响')).toBeNull()
    expect(screen.getByLabelText('服务地址')).toHaveValue('https://alias.example/anthropic')
    expect(screen.getByLabelText('模型名称')).toHaveValue('alias-model')
    expect(screen.getByLabelText('API 密钥')).toHaveValue('')
    for (const name of Object.values(anthropic.sourceVars)) expect(screen.getByText(`来自环境变量 ${name}`)).toBeInTheDocument()
    expect(screen.getByText('Claude CLI 模型档位映射，请确认模型名')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(testProvider).toHaveBeenCalledWith({ baseUrl: anthropic.baseUrl, model: 'alias-model' }, expect.any(AbortSignal)))
    expect(await screen.findByText('✓ 连接成功 · 8ms')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('AI 服务商'), { target: { value: 'codex' } })
    expect(screen.queryByText(/来自环境变量 ANTHROPIC_/)).toBeNull()
    expect(screen.queryByText('Claude CLI 模型档位映射，请确认模型名')).toBeNull()
    expect(screen.queryByText('✓ 连接成功 · 8ms')).toBeNull()
  })

  it('uses the Anthropic default URL and preserves a supported loaded provider on unrelated saves', async () => {
    const settings = { ...defaults, provider: 'anthropic' }
    const updateSettings = vi.fn(async (_patch: Record<string, unknown>) => settings)
    render(<ApiProvider api={{ getSettings: vi.fn(async () => settings), updateSettings } as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    expect(screen.getByLabelText('AI 服务商')).toHaveValue('anthropic')
    expect(screen.getByLabelText('服务地址')).toHaveValue('https://api.anthropic.com')
    expect(screen.queryByText(/不受支持/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存。')
    expect(updateSettings.mock.calls[0][0]).toEqual({ provider: 'anthropic', projectRoot: '', vaultPath: '' })
  })

  it('shows settings, environment and default source badges without key previews', async () => {
    const api = {
      getSettings: vi.fn(async () => ({
        ...defaults, baseUrl: 'https://saved.example/v1', hasApiKey: true,
        sources: { apiKey: 'env', baseUrl: 'settings', model: 'default' },
        sourceVars: { apiKey: 'VIBE_LLM_API_KEY' },
      })),
    }
    const { container } = render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    expect(screen.getByText('来自设置')).toBeInTheDocument()
    expect(screen.getByText('来自环境变量 VIBE_LLM_API_KEY')).toBeInTheDocument()
    expect(screen.getByText('默认值')).toBeInTheDocument()
    expect(screen.getByText('环境变量在本地服务启动时读取，修改后需重启服务')).toBeInTheDocument()
    expect(screen.getByLabelText('API 密钥')).toHaveValue('')
    expect(screen.getByLabelText('API 密钥')).toHaveAttribute('type', 'password')
    expect(container.innerHTML).not.toContain('fixture-env-private-KEY789')
    expect(container.innerHTML).not.toContain('Y789')
  })

  it('shows unset and default sources without an environment restart notice', async () => {
    const api = { getSettings: vi.fn(async () => defaults) }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    expect(screen.getByText('未配置')).toBeInTheDocument()
    expect(screen.getAllByText('默认值')).toHaveLength(2)
    expect(screen.queryByText('环境变量在本地服务启动时读取，修改后需重启服务')).toBeNull()
    expect(screen.getByLabelText('服务地址')).toHaveValue('https://api.openai.com/v1')
  })

  it('tests current unsaved values once, disables while busy, and displays success', async () => {
    let finish: (result: ProviderTestResult) => void = () => {}
    const testProvider = vi.fn(() => new Promise<ProviderTestResult>((resolve) => { finish = resolve }))
    const api = { getSettings: vi.fn(async () => envSettings), testProvider, updateSettings: vi.fn() }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://draft.example/v1' } })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'draft-model' } })
    const button = screen.getByRole('button', { name: '测试连接' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(testProvider).toHaveBeenCalledOnce()
    expect(testProvider).toHaveBeenCalledWith({ baseUrl: 'https://draft.example/v1', model: 'draft-model' }, expect.any(AbortSignal))
    expect(screen.getByRole('button', { name: '测试中…' })).toBeDisabled()
    expect(screen.getByLabelText('模型名称')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
    expect(api.updateSettings).not.toHaveBeenCalled()
    await act(async () => { finish({ ok: true, model: 'draft-model', latencyMs: 42 }) })
    expect(screen.getByRole('status')).toHaveTextContent('✓ 连接成功 · 42ms')
    expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'another-model' } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('sends a newly entered key through the client only for the connection request', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(
      String(input).endsWith('/settings/test') ? { ok: true, model: 'env-model', latencyMs: 5 } : envSettings,
    ), { headers: { 'content-type': 'application/json' } }))
    const api = createApi({ fetchImpl })
    render(<ApiProvider api={api}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'fixture-new-draft-key' } })
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功')
    const calls = fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/settings/test'))
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ baseUrl: envSettings.baseUrl, model: envSettings.model, apiKey: 'fixture-new-draft-key' }),
    })
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    expect(screen.getByRole('status')).not.toHaveTextContent('fixture-new-draft-key')
  })

  it('keeps unchanged environment values out of an unrelated settings save', async () => {
    const updateSettings = vi.fn(async (_patch: Record<string, unknown>) => envSettings)
    const api = { getSettings: vi.fn(async () => envSettings), updateSettings }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.change(screen.getByLabelText('项目代码目录'), { target: { value: '/new-project' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存。')
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/new-project' }), expect.any(AbortSignal))
    const patch = updateSettings.mock.calls[0][0]
    expect(patch).not.toHaveProperty('model')
    expect(patch).not.toHaveProperty('baseUrl')
    expect(patch).not.toHaveProperty('apiKey')
    expect(screen.getByText('来自环境变量 VIBE_LLM_MODEL')).toBeInTheDocument()
  })

  it.each([
    ['invalid-config', '请填写服务地址和模型名称'],
    ['auth', '认证失败'],
    ['not-found', '服务端点或模型不存在'],
    ['unreachable', '无法连接服务'],
    ['timeout', '连接超时'],
    ['http-error', '服务返回错误'],
  ] as const)('displays a readable %s result from an HTTP 200 response', async (code, text) => {
    const api = {
      getSettings: vi.fn(async () => envSettings),
      testProvider: vi.fn(async () => ({ ok: false, code, status: 503 })),
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent(`✗ ${text}`)
    expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
  })

  it('does not echo client exceptions and recovers after a hung request', async () => {
    const testProvider = vi.fn().mockRejectedValueOnce(new Error('fixture-env-private-KEY789'))
      .mockImplementationOnce(() => new Promise(() => {}))
    const api = { getSettings: vi.fn(async () => envSettings), testProvider }
    const { container } = render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await openAdvanced()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('status')).toHaveTextContent('无法连接服务')
    expect(container.innerHTML).not.toContain('fixture-env-private-KEY789')
    expect(container.innerHTML).not.toContain('Y789')
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(screen.getByRole('status')).toHaveTextContent('连接超时')
      expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
