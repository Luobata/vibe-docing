import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo, DEFAULT_PROVIDER_MODEL } from './settings-repo'

describe('SettingsRepo', () => {
  const aliasEnv = {
    ANTHROPIC_BASE_URL: 'https://alias.example/anthropic',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'alias-model',
    ANTHROPIC_AUTH_TOKEN: 'fixture-alias-token',
    ANTHROPIC_API_KEY: 'fixture-alias-key',
  }

  it('#18 codex ignores all ANTHROPIC_* variables, including after switching back', () => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, { ...aliasEnv, VIBE_LLM_MAX_TOKENS: '123' })
    const codex = { apiKey: null, baseUrl: null, model: DEFAULT_PROVIDER_MODEL, provider: 'codex' }
    expect(settings.getProviderConfig()).toEqual(codex)
    expect(settings.getProviderSources().sourceVars).toEqual({})
    settings.set('provider.name', 'anthropic')
    expect(settings.getProviderConfig()).toMatchObject({ apiKey: aliasEnv.ANTHROPIC_AUTH_TOKEN, maxTokens: 123 })
    settings.set('provider.name', 'codex')
    expect(settings.getProviderConfig()).toEqual(codex)
    expect(settings.getProviderSources().sourceVars).toEqual({})
    db.close()
  })

  it.each([
    ['baseUrl', ['VIBE_LLM_BASE_URL', 'ANTHROPIC_BASE_URL'], null],
    ['model', ['VIBE_LLM_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'], DEFAULT_PROVIDER_MODEL],
    ['apiKey', ['VIBE_LLM_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'], null],
  ] as const)('resolves every presence combination of the anthropic %s chain, with DB precedence', (field, vars, fallback) => {
    for (let mask = 0; mask < 2 ** vars.length; mask++) {
      const db = openMemoryDb()
      const env = Object.fromEntries(vars.map((name, index) => [name, mask & (1 << index) ? ` fixture-${name} ` : ' ']))
      const settings = createSettingsRepo(db, env)
      settings.set('provider.name', 'anthropic')
      const sourceVar = vars.find((_, index) => mask & (1 << index))
      expect(settings.getProviderConfig()[field]).toBe(sourceVar ? `fixture-${sourceVar}` : fallback)
      expect(settings.getProviderSources().sourceVars[field]).toBe(sourceVar)
      expect(settings.getProviderSources().sources[field]).toBe(sourceVar ? 'env' : field === 'apiKey' ? 'unset' : 'default')
      if (field === 'apiKey') expect(settings.getProviderConfig().apiKeySource).toBe(sourceVar ?? 'unset')
      settings.set(`provider.${field}`, 'saved-value')
      expect(settings.getProviderConfig()[field]).toBe('saved-value')
      expect(settings.getProviderSources().sources[field]).toBe('settings')
      expect(settings.getProviderSources().sourceVars[field]).toBeUndefined()
      if (field === 'apiKey') expect(settings.getProviderConfig().apiKeySource).toBe('settings')
      settings.set(`provider.${field}`, ' ')
      expect(settings.getProviderConfig()[field]).toBe(sourceVar ? `fixture-${sourceVar}` : fallback)
      db.close()
    }
  })

  it('selects startup alias variables after saving anthropic without persisting their values', () => {
    const db = openMemoryDb()
    const env = { ...aliasEnv }
    const settings = createSettingsRepo(db, env)
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'later-model'
    settings.set('provider.name', 'anthropic')
    expect(settings.getProviderConfig()).toEqual({
      provider: 'anthropic', apiKey: aliasEnv.ANTHROPIC_AUTH_TOKEN, apiKeySource: 'ANTHROPIC_AUTH_TOKEN',
      baseUrl: aliasEnv.ANTHROPIC_BASE_URL, model: 'alias-model', maxTokens: 32768,
    })
    expect(settings.getProviderSources()).toEqual({
      sources: { apiKey: 'env', baseUrl: 'env', model: 'env' },
      sourceVars: { apiKey: 'ANTHROPIC_AUTH_TOKEN', baseUrl: 'ANTHROPIC_BASE_URL', model: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
    })
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'provider.name', value: 'anthropic' }])
    db.close()
  })

  it.each([undefined, '', 'abc', '0', '-1', '1.5', '8192'])('uses a positive integer max_tokens override %j or the default', (value) => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, { VIBE_LLM_MAX_TOKENS: value })
    settings.set('provider.name', 'anthropic')
    expect(settings.getProviderConfig().maxTokens).toBe(value === '8192' ? 8192 : 32768)
    db.close()
  })

  it.each([
    ['db', 'env', 'settings'],
    ['db', undefined, 'settings'],
    [undefined, 'env', 'env'],
    ['', 'env', 'env'],
    ['   ', 'env', 'env'],
    [undefined, undefined, 'fallback'],
    ['', '  ', 'fallback'],
  ])('resolves DB %j and env %j with source %s', (dbValue, envValue, expectedSource) => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, {
      VIBE_LLM_API_KEY: envValue,
      VIBE_LLM_BASE_URL: envValue,
      VIBE_LLM_MODEL: envValue,
    })
    for (const field of ['apiKey', 'baseUrl', 'model']) {
      if (dbValue !== undefined) settings.set(`provider.${field}`, dbValue)
    }
    const expected = expectedSource === 'settings' ? dbValue : envValue
    expect(settings.getProviderConfig()).toEqual({
      apiKey: expectedSource === 'fallback' ? null : expected,
      baseUrl: expectedSource === 'fallback' ? null : expected,
      model: expectedSource === 'fallback' ? DEFAULT_PROVIDER_MODEL : expected,
      provider: 'codex',
    })
    expect(settings.getProviderSources()).toEqual({
      sources: expectedSource === 'fallback'
        ? { apiKey: 'unset', baseUrl: 'default', model: 'default' }
        : { apiKey: expectedSource, baseUrl: expectedSource, model: expectedSource },
      sourceVars: expectedSource === 'env'
        ? { apiKey: 'VIBE_LLM_API_KEY', baseUrl: 'VIBE_LLM_BASE_URL', model: 'VIBE_LLM_MODEL' }
        : {},
    })
    db.close()
  })

  it('fills missing fields independently without persisting environment values', () => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, { VIBE_LLM_API_KEY: 'fixture-env-key' })
    settings.set('provider.baseUrl', 'https://db.example/v1')
    expect(settings.getProviderConfig()).toEqual({
      apiKey: 'fixture-env-key', baseUrl: 'https://db.example/v1', model: DEFAULT_PROVIDER_MODEL, provider: 'codex',
    })
    expect(settings.getProviderSources()).toEqual({
      sources: { apiKey: 'env', baseUrl: 'settings', model: 'default' },
      sourceVars: { apiKey: 'VIBE_LLM_API_KEY' },
    })
    expect(db.prepare('SELECT * FROM settings').all()).toEqual([{ key: 'provider.baseUrl', value: 'https://db.example/v1' }])
    db.close()
  })

  it('ignores unrelated vendor variables and does not take the provider name from env', () => {
    const db = openMemoryDb()
    const settings = createSettingsRepo(db, { GLM_API_KEY: 'fixture-vendor-key', OPENAI_API_KEY: 'fixture-other-key', VIBE_LLM_PROVIDER: 'other' })
    expect(settings.getProviderConfig()).toEqual({ apiKey: null, baseUrl: null, model: DEFAULT_PROVIDER_MODEL, provider: 'codex' })
    db.close()
  })

  it('snapshots env at construction while settings changes take effect immediately', () => {
    const db = openMemoryDb()
    const env = { VIBE_LLM_MODEL: 'startup-model' }
    const settings = createSettingsRepo(db, env)
    env.VIBE_LLM_MODEL = 'later-model'
    expect(settings.getProviderConfig().model).toBe('startup-model')
    settings.set('provider.model', 'saved-model')
    expect(settings.getProviderConfig().model).toBe('saved-model')
    expect(settings.getProviderSources().sources.model).toBe('settings')
    db.close()
  })

  it('returns the default Codex configuration', () => {
    const settings = createSettingsRepo(openMemoryDb(), {})
    expect(settings.getProviderConfig()).toEqual({
      apiKey: null,
      baseUrl: null,
      model: DEFAULT_PROVIDER_MODEL,
      provider: 'codex',
    })
  })

  it.each([
    'experimental_0717',
    'model_api/experimental_0717',
    'experimanetental_0717',
    'model_api/experimanetental_0717',
  ])('migrates the legacy model %s without touching other settings', (legacyModel) => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.model', legacyModel)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.name', 'codex')

    const settings = createSettingsRepo(db, {})

    expect(settings.get('provider.model')).toBe(DEFAULT_PROVIDER_MODEL)
    expect(settings.get('provider.name')).toBe('codex')
  })

  it('preserves a user-selected non-legacy model', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.model', 'custom-model')

    const settings = createSettingsRepo(db, {})

    expect(settings.getProviderConfig().model).toBe('custom-model')
  })

  it('upserts settings values', () => {
    const settings = createSettingsRepo(openMemoryDb(), {})
    settings.set('provider.model', 'codex-test')
    settings.set('provider.model', 'codex-test-2')
    expect(settings.get('provider.model')).toBe('codex-test-2')
  })

  it('returns the configured project root', () => {
    const settings = createSettingsRepo(openMemoryDb(), {})
    settings.set('project.root', '/tmp/project')
    expect(settings.getProjectRoot()).toBe('/tmp/project')
  })

  it('returns null when the project root is unset', () => {
    const settings = createSettingsRepo(openMemoryDb(), {})
    expect(settings.getProjectRoot()).toBeNull()
  })

  it('returns null when the project root is whitespace only', () => {
    const settings = createSettingsRepo(openMemoryDb(), {})
    settings.set('project.root', '   ')
    expect(settings.getProjectRoot()).toBeNull()
  })
})
