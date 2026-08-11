import type { Db } from '../db/connection'

export interface ProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  model: string
  provider: string
}

export const DEFAULT_PROVIDER_MODEL = 'alwaysday1_max'

const LEGACY_PROVIDER_MODELS = new Set([
  'experimental_0717',
  'model_api/experimental_0717',
  'experimanetental_0717',
  'model_api/experimanetental_0717',
])

export function createSettingsRepo(db: Db) {
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

  function getProviderConfig(): ProviderConfig {
    return {
      apiKey: get('provider.apiKey') ?? null,
      baseUrl: get('provider.baseUrl') ?? null,
      model: get('provider.model') ?? DEFAULT_PROVIDER_MODEL,
      provider: get('provider.name') ?? 'codex',
    }
  }

  function getProjectRoot(): string | null {
    const v = get('project.root')
    return v && v.trim() ? v : null
  }

  const configuredModel = get('provider.model')
  if (configuredModel && LEGACY_PROVIDER_MODELS.has(configuredModel.trim())) {
    set('provider.model', DEFAULT_PROVIDER_MODEL)
  }

  return { get, getProjectRoot, getProviderConfig, set }
}
