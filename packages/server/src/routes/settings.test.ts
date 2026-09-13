import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { DEFAULT_PROVIDER_MODEL } from '../repo/settings-repo'
import { fixedClock } from '../util/clock'

describe('settings routes', () => {
  it.each([
    ['codex', 'anthropic', false], ['codex', 'anthropic', true],
    ['anthropic', 'codex', false], ['anthropic', 'codex', true],
  ] as const)('clears saved connection fields on %s -> %s even with payload fields: %j', async (previous, next, withFields) => {
    const deps = createDeps({ db: openMemoryDb(), env: {
      ANTHROPIC_BASE_URL: 'https://alias.example', ANTHROPIC_DEFAULT_OPUS_MODEL: 'alias-model', ANTHROPIC_AUTH_TOKEN: 'fixture-alias-key',
    } })
    deps.settings.set('provider.name', previous)
    for (const field of ['baseUrl', 'model', 'apiKey']) deps.settings.set(`provider.${field}`, `saved-${field}`)
    const app = buildApp(deps)
    try {
      const response = await app.inject({ method: 'PUT', url: '/api/settings', payload: {
        provider: next, ...(withFields ? { baseUrl: 'https://draft.example', model: 'draft-model', apiKey: 'fixture-draft-key' } : {}),
      } })
      expect(response.statusCode).toBe(200)
      for (const field of ['baseUrl', 'model', 'apiKey']) expect(deps.settings.get(`provider.${field}`)).toBe('')
      expect(response.json()).toMatchObject(next === 'anthropic' ? {
        provider: next, baseUrl: 'https://alias.example', model: 'alias-model', hasApiKey: true,
        sources: { baseUrl: 'env', model: 'env', apiKey: 'env' },
        sourceVars: { baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', apiKey: 'ANTHROPIC_AUTH_TOKEN' },
      } : { provider: next, baseUrl: null, model: DEFAULT_PROVIDER_MODEL, hasApiKey: false, sourceVars: {} })
      expect(response.body).not.toContain('fixture-')
    } finally { await app.close(); deps.db.close() }
  })

  it.each(['codex', 'legacy'])('preserves connection fields when saving codex from %s without switching a supported provider', async (previous) => {
    const deps = createDeps({ db: openMemoryDb(), env: {} })
    deps.settings.set('provider.name', previous)
    deps.settings.set('provider.baseUrl', 'https://saved.example')
    deps.settings.set('provider.apiKey', 'fixture-saved-key')
    const app = buildApp(deps)
    try {
      const response = await app.inject({ method: 'PUT', url: '/api/settings', payload: { provider: 'codex', model: 'new-model' } })
      expect(response.statusCode).toBe(200)
      expect(deps.settings.getProviderConfig()).toMatchObject({ baseUrl: 'https://saved.example', apiKey: 'fixture-saved-key', model: 'new-model' })
    } finally { await app.close(); deps.db.close() }
  })

  it('accepts anthropic and rejects an unknown provider before writing any settings', async () => {
    const deps = createDeps({ env: {}, db: openMemoryDb() })
    const app = buildApp(deps)
    try {
      const accepted = await app.inject({ method: 'PUT', url: '/api/settings', payload: { provider: 'anthropic' } })
      expect(accepted.statusCode).toBe(200)
      expect(accepted.json().provider).toBe('anthropic')
      const before = deps.db.prepare('SELECT * FROM settings ORDER BY key').all()
      const rejected = await app.inject({ method: 'PUT', url: '/api/settings', payload: { provider: 'custom', model: 'do-not-save' } })
      expect(rejected.statusCode).toBe(400)
      expect(deps.settings.get('provider.name')).toBe('anthropic')
      expect(deps.db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
    } finally { await app.close(); deps.db.close() }
  })

  it('reads defaults and updates provider config without leaking the key', async () => {
    const deps = createDeps({ env: {}, db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const app = buildApp(deps)
    const defaults = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(defaults.statusCode).toBe(200)
    expect(defaults.json()).toMatchObject({ baseUrl: null, hasApiKey: false, model: DEFAULT_PROVIDER_MODEL, projectRoot: null, provider: 'codex' })
    expect(defaults.json().vaultPath).toContain('vibe-docing-memory-vault-')

    const updated = await app.inject({
      method: 'PUT', payload: { apiKey: 'secret', baseUrl: 'https://example.test', model: 'gpt-x', provider: 'codex' },
      url: '/api/settings',
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ baseUrl: 'https://example.test', hasApiKey: true, model: 'gpt-x', provider: 'codex' })
    expect(updated.body).not.toContain('secret')
    expect(deps.settings.get('provider.apiKey')).toBe('secret')
    await app.close()
  })

  it('persists and echoes the project root', async () => {
    const deps = createDeps({ env: {}, db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const app = buildApp(deps)

    const defaults = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(defaults.json()).toMatchObject({ projectRoot: null })

    const updated = await app.inject({ method: 'PUT', payload: { projectRoot: '/tmp' }, url: '/api/settings' })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ projectRoot: '/tmp' })

    const after = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(after.json()).toMatchObject({ projectRoot: '/tmp' })
    expect(Object.keys(after.json())).not.toContain('apiKey')
    expect(after.json()).toMatchObject({ hasApiKey: false })
    await app.close()
  })

  it('rejects unknown or invalid fields without partial writes', async () => {
    const deps = createDeps({ env: {}, db: openMemoryDb() })
    const app = buildApp(deps)
    const response = await app.inject({ method: 'PUT', payload: { apiKey: 42, unexpected: 'x' }, url: '/api/settings' })
    expect(response.statusCode).toBe(400)
    expect(deps.settings.get('provider.apiKey')).toBeUndefined()
    await app.close()
  })
})

describe('Anthropic settings probe', () => {
  it.each([
    ['ANTHROPIC_AUTH_TOKEN', undefined, false, 'authorization'],
    ['ANTHROPIC_API_KEY', undefined, false, 'x-api-key'],
    ['VIBE_LLM_API_KEY', undefined, false, 'x-api-key'],
    ['ANTHROPIC_AUTH_TOKEN', undefined, true, 'x-api-key'],
    ['ANTHROPIC_AUTH_TOKEN', 'fixture-draft', false, 'x-api-key'],
    ['ANTHROPIC_AUTH_TOKEN', '', false, null],
  ] as const)('#24 routes saved anthropic to Messages with one auth header: %s / draft %j / DB %j', async (keyVar, draftKey, dbKey, header) => {
    const providerFetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
    const deps = createDeps({ db: openMemoryDb(), providerFetch, env: {
      [keyVar]: 'fixture-env', ANTHROPIC_BASE_URL: 'https://alias.example', ANTHROPIC_DEFAULT_OPUS_MODEL: 'alias-model',
    } })
    const app = buildApp(deps)
    try {
      const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { provider: 'anthropic' } })
      if (dbKey) await app.inject({ method: 'PUT', url: '/api/settings', payload: { apiKey: 'fixture-db' } })
      expect(saved.json()).toMatchObject({ provider: 'anthropic', baseUrl: 'https://alias.example', model: 'alias-model' })
      expect(saved.json().sourceVars).toMatchObject({ baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_DEFAULT_OPUS_MODEL' })
      expect(saved.body).not.toContain('fixture-env')
      const before = deps.db.prepare('SELECT * FROM settings ORDER BY key').all()
      const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: {
        baseUrl: 'https://draft.example/anthropic/', model: 'draft-model', provider: 'codex',
        ...(draftKey !== undefined ? { apiKey: draftKey } : {}),
      } })
      expect(response.json()).toEqual({ ok: true, model: 'draft-model', latencyMs: expect.any(Number) })
      expect(providerFetch).toHaveBeenCalledOnce()
      const [url, init] = providerFetch.mock.calls[0]
      expect(url).toBe('https://draft.example/anthropic/v1/messages')
      const headers = new Headers(init?.headers)
      const key = draftKey ?? (dbKey ? 'fixture-db' : 'fixture-env')
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('authorization')).toBe(header === 'authorization' ? `Bearer ${key}` : null)
      expect(headers.get('x-api-key')).toBe(header === 'x-api-key' ? key : null)
      expect(JSON.parse(init?.body as string)).toEqual({ model: 'draft-model', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(deps.db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
      expect(response.body).not.toContain('fixture-')
    } finally { await app.close(); deps.db.close() }
  })

  it('preserves auth error classification and does not expose the Anthropic upstream body', async () => {
    const deps = createDeps({ db: openMemoryDb(), env: { ANTHROPIC_AUTH_TOKEN: 'fixture-token' }, providerFetch: async () => new Response('fixture-token', { status: 403 }) })
    deps.settings.set('provider.name', 'anthropic')
    const app = buildApp(deps)
    try {
      const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: { baseUrl: 'https://alias.example', model: 'alias-model' } })
      expect(response.json()).toEqual({ ok: false, code: 'auth', status: 403 })
    } finally { await app.close(); deps.db.close() }
  })

  it('does not probe a legacy unknown provider using the wrong protocol', async () => {
    const providerFetch = vi.fn(async () => new Response('{}'))
    const deps = createDeps({ db: openMemoryDb(), env: {}, providerFetch })
    deps.settings.set('provider.name', 'legacy')
    const app = buildApp(deps)
    try {
      const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: { baseUrl: 'https://alias.example', model: 'm' } })
      expect(response.json()).toEqual({ ok: false, code: 'invalid-config' })
      expect(providerFetch).not.toHaveBeenCalled()
    } finally { await app.close(); deps.db.close() }
  })
})

describe('provider settings metadata and connection test', () => {
  const apps: ReturnType<typeof buildApp>[] = []
  const envKey = 'fixture-env-private-KEY789'
  const dbKey = 'fixture-db-private-KEY456'
  function setup(providerFetch: typeof fetch = async () => new Response('{}')) {
    const deps = createDeps({
      db: openMemoryDb(), providerFetch,
      env: { VIBE_LLM_API_KEY: envKey, VIBE_LLM_MODEL: 'env-model' },
    })
    const app = buildApp(deps)
    apps.push(app)
    return { app, deps }
  }
  const config = { baseUrl: 'https://draft.example/v1/', model: 'draft-model' }
  afterEach(async () => {
    vi.useRealTimers()
    for (const app of apps.splice(0)) {
      await app.close()
      app.deps.db.close()
    }
  })
  function expectNoKey(body: string) {
    for (const key of [envKey, dbKey]) {
      expect(body).not.toContain(key)
      expect(body).not.toContain(key.slice(-4))
    }
  }

  it('reports sources and variable names without returning any key fragment', async () => {
    const { app, deps } = setup()
    deps.settings.set('provider.baseUrl', 'https://saved.example/v1')
    const response = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(response.json()).toMatchObject({
      hasApiKey: true, model: 'env-model', baseUrl: 'https://saved.example/v1',
      sources: { apiKey: 'env', baseUrl: 'settings', model: 'env' },
      sourceVars: { apiKey: 'VIBE_LLM_API_KEY', model: 'VIBE_LLM_MODEL' },
    })
    expect(Object.keys(response.json())).not.toContain('apiKey')
    expectNoKey(response.body)
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { apiKey: dbKey } })
    expect(saved.json()).toMatchObject({ hasApiKey: true, sources: { apiKey: 'settings' }, sourceVars: { model: 'VIBE_LLM_MODEL' } })
    expect(saved.json().sourceVars).not.toHaveProperty('apiKey')
    expectNoKey(saved.body)
  })

  it('uses unsaved non-secret fields and falls back to the effective key without saving', async () => {
    const providerFetch = vi.fn(async () => new Response('{}'))
    const { app, deps } = setup(providerFetch)
    deps.settings.set('provider.baseUrl', 'https://saved.example/v1')
    deps.settings.set('provider.model', 'saved-model')
    deps.settings.set('provider.apiKey', dbKey)
    const before = deps.db.prepare('SELECT * FROM settings ORDER BY key').all()
    const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: config })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, model: 'draft-model', latencyMs: expect.any(Number) })
    expect(providerFetch).toHaveBeenCalledWith('https://draft.example/v1/chat/completions', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: `Bearer ${dbKey}` }),
      signal: expect.any(AbortSignal),
      body: JSON.stringify({ model: 'draft-model', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    }))
    expect(deps.db.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(before)
    expectNoKey(response.body)
  })

  it.each([undefined, 'fixture-draft-key', ''])('handles the optional draft key %j without treating an explicit empty value as fallback', async (apiKey) => {
    const providerFetch = vi.fn(async () => new Response('{}'))
    const { app } = setup(providerFetch)
    const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: { ...config, ...(apiKey === undefined ? {} : { apiKey }) } })
    expect(response.statusCode).toBe(200)
    expect(response.json().ok).toBe(true)
    const expectedKey = apiKey === undefined ? envKey : apiKey
    expect(providerFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expectedKey ? expect.objectContaining({ authorization: `Bearer ${expectedKey}` }) : { 'content-type': 'application/json' },
    }))
    expectNoKey(response.body)
    expect(response.body).not.toContain('fixture-draft-key')
  })

  it.each([[401, 'auth'], [403, 'auth'], [404, 'not-found'], [400, 'http-error'], [500, 'http-error']])('maps upstream %s to %s without forwarding its body', async (status, code) => {
    const { app } = setup(async () => new Response(`upstream echoed ${envKey}`, { status: Number(status) }))
    const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: config })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: false, code, status })
    expectNoKey(response.body)
  })

  it('returns only unreachable for network errors even if their messages contain keys', async () => {
    const { app } = setup(async () => { throw new Error(`network error ${envKey}`) })
    const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload: config })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: false, code: 'unreachable' })
    expectNoKey(response.body)
  })

  it('aborts the probe at ten seconds and returns timeout without leaking key errors', async () => {
    const providerFetch = vi.fn((_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${envKey}`)), { once: true })
    }))
    const { app } = setup(providerFetch)
    vi.useFakeTimers()
    const pending = app.inject({ method: 'POST', url: '/api/settings/test', payload: config })
    const result = Promise.resolve(pending)
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(10_000)
    const response = await result
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: false, code: 'timeout' })
    expect(providerFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expectNoKey(response.body)
  })

  it.each([{}, { baseUrl: '', model: 'm' }, { baseUrl: 'https://draft.example', model: ' ' }, { baseUrl: 42, model: 'm' }])('rejects invalid probe configuration %j without using saved non-secret fields', async (payload) => {
    const providerFetch = vi.fn(async () => new Response('{}'))
    const { app, deps } = setup(providerFetch)
    deps.settings.set('provider.baseUrl', 'https://saved.example/v1')
    deps.settings.set('provider.model', 'saved-model')
    const response = await app.inject({ method: 'POST', url: '/api/settings/test', payload })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: false, code: 'invalid-config' })
    expect(providerFetch).not.toHaveBeenCalled()
    expectNoKey(response.body)
  })
})
