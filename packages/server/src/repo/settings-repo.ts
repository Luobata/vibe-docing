import type { Db } from '../db/connection'

export interface ProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  model: string
  provider: string
  apiKeySource?: string
  maxTokens?: number
}

export const DEFAULT_PROVIDER_MODEL = 'alwaysday1_max'

type ProviderField = 'apiKey' | 'baseUrl' | 'model'
type ConfigSource = 'settings' | 'env' | 'default' | 'unset'

const LEGACY_PROVIDER_MODELS = new Set([
  'experimental_0717',
  'model_api/experimental_0717',
  'experimanetental_0717',
  'model_api/experimanetental_0717',
])

export function createSettingsRepo(db: Db, env: Record<string, string | undefined> = process.env) {
  const sourceVars = { apiKey: ['VIBE_LLM_API_KEY'], baseUrl: ['VIBE_LLM_BASE_URL'], model: ['VIBE_LLM_MODEL'] }
  const anthropicVars = {
    apiKey: [...sourceVars.apiKey, 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    baseUrl: [...sourceVars.baseUrl, 'ANTHROPIC_BASE_URL'],
    model: [...sourceVars.model, 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  }
  // Snapshot supported variables at startup; select the chain using the saved provider.
  const providerEnv = Object.fromEntries(
    [...Object.values(anthropicVars).flat(), 'VIBE_LLM_MAX_TOKENS'].map((name) => [name, env[name]?.trim()]),
  )
  function get(key: string): string | undefined {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value
  }

  function set(key: string, value: string): void {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value)
  }

  function resolveField(provider: string, field: ProviderField, fallback: string | null): { value: string | null; source: ConfigSource; sourceVar?: string } {
    const value = get(`provider.${field}`)
    if (value?.trim()) return { value, source: 'settings' }
    const variables = provider === 'anthropic' ? anthropicVars : sourceVars
    for (const sourceVar of variables[field]) {
      const envValue = providerEnv[sourceVar]
      if (envValue) return { value: envValue, source: 'env', sourceVar }
    }
    return { value: fallback, source: field === 'apiKey' ? 'unset' : 'default' }
  }

  function getProviderConfig(): ProviderConfig {
    const provider = get('provider.name') ?? 'codex'
    const apiKey = resolveField(provider, 'apiKey', null)
    const maxTokens = Number(providerEnv.VIBE_LLM_MAX_TOKENS)
    return {
      apiKey: apiKey.value,
      baseUrl: resolveField(provider, 'baseUrl', null).value,
      model: resolveField(provider, 'model', DEFAULT_PROVIDER_MODEL).value!,
      provider,
      ...(provider === 'anthropic' ? {
        apiKeySource: apiKey.sourceVar ?? apiKey.source,
        maxTokens: Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : 32768,
      } : {}),
    }
  }

  function getProviderSources() {
    const provider = get('provider.name') ?? 'codex'
    const sources = {} as Record<ProviderField, ConfigSource>
    const activeVars: Partial<Record<ProviderField, string>> = {}
    for (const field of ['apiKey', 'baseUrl', 'model'] as const) {
      const resolved = resolveField(provider, field, field === 'model' ? DEFAULT_PROVIDER_MODEL : null)
      sources[field] = resolved.source
      if (resolved.sourceVar) activeVars[field] = resolved.sourceVar
    }
    return { sources, sourceVars: activeVars }
  }

  function getProjectRoot(): string | null {
    const v = get('project.root')
    return v && v.trim() ? v : null
  }

  function getVaultPath(): string | null {
    const value = get('vault.path')
    return value && value.trim() ? value.trim() : null
  }

  const configuredModel = get('provider.model')
  if (configuredModel && LEGACY_PROVIDER_MODELS.has(configuredModel.trim())) {
    set('provider.model', DEFAULT_PROVIDER_MODEL)
  }

  return { get, getProjectRoot, getProviderConfig, getProviderSources, getVaultPath, set }
}
