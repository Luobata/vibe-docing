import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo } from '../repo/settings-repo'
import { createMockProvider } from './mock-provider'
import { ProviderConfigError, resolveProvider } from './registry'

describe('resolveProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['codex', 'anthropic'])('routes the %s adapter to its protocol with resolved config', async (providerName) => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, {
      VIBE_LLM_BASE_URL: 'https://provider.example', VIBE_LLM_MODEL: 'fixture-model',
      VIBE_LLM_API_KEY: 'fixture-key', VIBE_LLM_MAX_TOKENS: '8192',
    })
    settings.set('provider.name', providerName)
    const fetchImpl = vi.fn(async () => new Response(providerName === 'codex'
      ? 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
      : 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: {"type":"message_stop"}\n\n'))
    vi.stubGlobal('fetch', fetchImpl)
    const provider = resolveProvider({ settings })
    expect(await provider.complete([{ role: 'user', content: 'ping' }])).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledWith(`https://provider.example/${providerName === 'codex' ? 'chat/completions' : 'v1/messages'}`, expect.any(Object))
    if (providerName === 'anthropic') expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.stringContaining('"max_tokens":8192') }))
    db.close()
  })

  it('uses an injected provider without reading the network', () => {
    const override = createMockProvider({ chunks: ['offline'] })
    const provider = resolveProvider(
      { settings: createSettingsRepo(openMemoryDb()) },
      override,
    )
    expect(provider).toBe(override)
  })

  it('constructs the configured Codex adapter lazily', () => {
    const settings = createSettingsRepo(openMemoryDb())
    const provider = resolveProvider({ settings })
    expect(provider.stream).toBeTypeOf('function')
    expect(provider.complete).toBeTypeOf('function')
  })

  it('throws a typed configuration error for an unsupported provider', () => {
    const settings = createSettingsRepo(openMemoryDb())
    settings.set('provider.name', 'claude-o50')

    expect(() => resolveProvider({ settings })).toThrow(ProviderConfigError)
    expect(() => resolveProvider({ settings })).toThrow('Unsupported provider: claude-o50')
  })
})
